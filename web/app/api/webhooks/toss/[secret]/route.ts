import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { syncCachedPlan } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { billingKeyHash, getTossPaymentByOrderId, safeSecretEqual } from "@/lib/toss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  eventType: z.string().max(80),
  createdAt: z.string().optional(),
  billingKey: z.string().optional(),
  reason: z.string().nullable().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ secret: string }> },
) {
  const expected = process.env.TOSS_WEBHOOK_SECRET || "";
  const provided = (await context.params).secret;
  if (!expected || !safeSecretEqual(expected, provided)) {
    return NextResponse.json({ detail: "Not found" }, { status: 404 });
  }
  const raw = await request.text();
  let event;
  try {
    event = schema.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ detail: "Invalid webhook" }, { status: 400 });
  }
  const transmissionId = request.headers.get("tosspayments-webhook-transmission-id")
    || createHash("sha256").update(raw).digest("hex");
  const db = getDb();
  const inserted = await db`
    insert into shorts_mvp.billing_webhook_events (
      transmission_id,event_type,provider_created_at
    ) values (
      ${transmissionId.slice(0,200)},${event.eventType},${event.createdAt ? new Date(event.createdAt) : null}
    ) on conflict (transmission_id) do nothing returning transmission_id
  `;
  if (!inserted[0]) return NextResponse.json({ ok: true, duplicate: true });
  try {
    if (event.eventType === "PAYMENT_STATUS_CHANGED") {
      const orderId = typeof event.data?.orderId === "string" ? event.data.orderId : null;
      if (!orderId) throw new Error("MISSING_ORDER_ID");
      const payment = await getTossPaymentByOrderId(orderId);
      const orders = await db`
        select o.* from shorts_mvp.billing_orders o
        left join shorts_mvp.billing_attempts a on a.order_id=o.id
        where o.order_id=${orderId} or a.provider_order_id=${orderId}
        order by o.created_at desc limit 1
      `;
      const order = orders[0];
      if (order) {
        await db`
          update shorts_mvp.billing_orders
          set provider_status=${payment.status},
              status=case when ${payment.status} in ('CANCELED','PARTIAL_CANCELED') then 'canceled' else status end
          where id=${order.id}
        `;
        if (order.kind === "addon" && ["CANCELED", "PARTIAL_CANCELED"].includes(payment.status)) {
          await db`
            update shorts_mvp.usage_grants set status='revoked'
            where billing_order_id=${order.id} and kind='addon'
              and consumed_seconds=0 and reserved_seconds=0
          `;
        }
        if (
          payment.status === "CANCELED"
          && order.kind !== "addon"
          && order.subscriptionId
        ) {
          await db.begin(async (tx) => {
            await tx`
              update shorts_mvp.user_subscriptions
              set status='expired',ended_at=now(),next_charge_at=null,next_retry_at=null,next_quota_at=null
              where id=${order.subscriptionId} and status in ('active','past_due')
            `;
            await tx`
              update shorts_mvp.usage_grants set status='revoked'
              where subscription_id=${order.subscriptionId} and kind='base' and status='active'
            `;
            await syncCachedPlan(tx, order.userId, "free");
          });
        }
      }
    } else if (event.eventType === "BILLING_DELETED" && event.billingKey) {
      const methods = await db`
        update shorts_mvp.billing_payment_methods
        set status='revoked',revoked_at=now()
        where billing_key_hash=${billingKeyHash(event.billingKey)} and status<>'revoked'
        returning id,user_id
      `;
      for (const method of methods) {
        await db.begin(async (tx) => {
          await tx`
            update shorts_mvp.user_subscriptions
            set status='expired',ended_at=now(),next_charge_at=null,next_retry_at=null,next_quota_at=null
            where payment_method_id=${method.id} and status in ('active','past_due')
          `;
          await tx`
            update shorts_mvp.usage_grants set status='revoked'
            where subscription_id in (
              select id from shorts_mvp.user_subscriptions where payment_method_id=${method.id}
            ) and kind='base' and status='active'
          `;
          await syncCachedPlan(tx, method.userId, "free");
        });
      }
    }
    await db`
      update shorts_mvp.billing_webhook_events
      set status='processed',processed_at=now() where transmission_id=${transmissionId.slice(0,200)}
    `;
    return NextResponse.json({ ok: true });
  } catch (error) {
    await db`
      update shorts_mvp.billing_webhook_events
      set status='failed',error_code=${error instanceof Error ? error.message.slice(0,100) : "WEBHOOK_ERROR"},processed_at=now()
      where transmission_id=${transmissionId.slice(0,200)}
    `;
    return NextResponse.json({ detail: "Webhook processing failed" }, { status: 500 });
  }
}
