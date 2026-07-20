import { NextResponse } from "next/server";
import { z } from "zod";
import { billingCycles, paidPlanCodes } from "@/lib/contracts";
import {
  createProviderOrderId,
  ensureTossCustomerKey,
  getPaidPlan,
} from "@/lib/billing";
import { assertBillingMutationRequest, checkoutUrls } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { tossClientKey } from "@/lib/toss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("subscribe"),
    planCode: z.enum(paidPlanCodes),
    billingCycle: z.enum(billingCycles),
    requestId: z.string().uuid(),
  }),
  z.object({
    mode: z.literal("replace_payment_method"),
    requestId: z.string().uuid(),
  }),
]);

export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const body = schema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const customerKey = await ensureTossCustomerKey(db, session.userId);
    let product;
    let cycle;
    let amount;
    let kind: "subscription_initial" | "payment_method_update";
    let subscriptionId: string | null = null;
    if (body.mode === "subscribe") {
      const current = await db`
        select id from shorts_mvp.user_subscriptions
        where user_id=${session.userId} and status in ('pending','trialing','active','past_due')
        limit 1
      `;
      if (current[0]) throw new HttpError(409, "이미 구독이 있습니다. 플랜 변경 기능을 이용해 주세요.");
      product = await getPaidPlan(db, body.planCode);
      cycle = body.billingCycle;
      amount = cycle === "monthly" ? product.monthlyPriceKrw : product.yearlyPriceKrw;
      kind = "subscription_initial";
    } else {
      const currentRows = await db`
        select s.*,p.display_name,p.monthly_source_seconds,p.retention_days,
          p.monthly_price_krw,p.yearly_price_krw,p.max_active_jobs
        from shorts_mvp.user_subscriptions s
        join shorts_mvp.plans p on p.code=s.plan_code
        where s.user_id=${session.userId} and s.status in ('active','past_due')
        order by s.created_at desc limit 1
      `;
      const current = currentRows[0];
      if (!current) throw new HttpError(409, "변경할 구독을 찾을 수 없습니다.");
      product = await getPaidPlan(db, current.planCode);
      cycle = current.billingCycle;
      amount = 0;
      kind = "payment_method_update";
      subscriptionId = current.id;
    }
    const orderId = createProviderOrderId(kind === "subscription_initial" ? "SUB" : "PM");
    const orderName = kind === "subscription_initial"
      ? `Easy Cut ${product.displayName} ${cycle === "monthly" ? "월간" : "연간"} 구독`
      : "Easy Cut 정기결제 카드 변경";
    const rows = await db`
      insert into shorts_mvp.billing_orders (
        user_id,subscription_id,request_id,kind,product_code,billing_cycle,
        amount_krw,order_id,order_name,customer_key,checkout_expires_at
      ) values (
        ${session.userId},${subscriptionId},${body.requestId},${kind},${product.code},${cycle},
        ${amount},${orderId},${orderName},${customerKey},now()+interval '20 minutes'
      )
      on conflict (request_id) do nothing
      returning id,order_id,order_name,amount_krw,customer_key,kind,status
    `;
    const order = rows[0] || (await db`
      select id,order_id,order_name,amount_krw,customer_key,kind,status
      from shorts_mvp.billing_orders
      where request_id=${body.requestId} and user_id=${session.userId}
      limit 1
    `)[0];
    if (!order) throw new HttpError(409, "결제 요청 식별자가 이미 사용되었습니다.");
    if (order.status !== "pending") throw new HttpError(409, "이미 처리된 결제 요청입니다.");
    return NextResponse.json({
      checkoutId: order.id,
      clientKey: tossClientKey(),
      customerKey: order.customerKey,
      orderId: order.orderId,
      orderName: order.orderName,
      amount: Number(order.amountKrw),
      customerEmail: session.user?.email || null,
      customerName: session.user?.displayName || null,
      ...checkoutUrls(request, "subscription", order.id),
    });
  } catch (error) {
    return apiError(error, "구독 결제를 시작하지 못했습니다.");
  }
}
