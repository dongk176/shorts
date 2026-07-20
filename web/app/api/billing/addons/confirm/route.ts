import { NextResponse } from "next/server";
import { z } from "zod";
import { getAddonProduct, requireActiveSubscription } from "@/lib/billing";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { confirmTossPayment, getTossPaymentByOrderId, TossApiError } from "@/lib/toss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  checkoutId: z.string().uuid(),
  paymentKey: z.string().min(1).max(200),
  orderId: z.string().min(6).max(64),
});

export async function POST(request: Request) {
  let checkoutId: string | null = null;
  let billingAttemptId: string | null = null;
  let claimedOrder = false;
  let providerPaymentCompleted = false;
  try {
    assertBillingMutationRequest(request);
    const body = schema.parse(await request.json());
    checkoutId = body.checkoutId;
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const rows = await db`
      select * from shorts_mvp.billing_orders
      where id=${body.checkoutId} and user_id=${session.userId} and kind='addon'
      limit 1
    `;
    const order = rows[0];
    if (!order) throw new HttpError(404, "추가 시간 주문을 찾을 수 없습니다.");
    if (order.status === "succeeded") {
      return NextResponse.json({ ok: true, orderId: order.orderId, alreadyProcessed: true });
    }
    if (
      order.status !== "pending"
      || order.orderId !== body.orderId
      || !order.checkoutExpiresAt
      || order.checkoutExpiresAt <= new Date()
    ) throw new HttpError(409, "추가 시간 주문이 만료되었거나 주문 정보가 일치하지 않습니다.");
    await requireActiveSubscription(db, session.userId);
    const claimed = await db`
      update shorts_mvp.billing_orders set status='processing'
      where id=${order.id} and status='pending'
      returning id
    `;
    if (!claimed[0]) throw new HttpError(409, "다른 요청에서 추가 시간 결제를 처리하고 있습니다.");
    claimedOrder = true;
    const attempts = await db`
      insert into shorts_mvp.billing_attempts (order_id,attempt_no,provider_order_id)
      values (${order.id},1,${order.orderId})
      on conflict (order_id,attempt_no) do nothing
      returning id
    `;
    billingAttemptId = attempts[0]?.id || null;
    if (!billingAttemptId) throw new HttpError(409, "추가 시간 결제 승인이 이미 처리 중입니다.");
    let payment;
    try {
      payment = await confirmTossPayment(body.paymentKey, order.orderId, Number(order.amountKrw));
    } catch (error) {
      if (error instanceof TossApiError && error.code === "ALREADY_PROCESSED_PAYMENT") {
        payment = await getTossPaymentByOrderId(order.orderId);
      } else {
        throw error;
      }
    }
    providerPaymentCompleted = payment.status === "DONE";
    if (
      payment.orderId !== order.orderId
      || payment.paymentKey !== body.paymentKey
      || payment.totalAmount !== Number(order.amountKrw)
      || payment.status !== "DONE"
    ) throw new HttpError(502, "추가 시간 결제 승인 결과가 주문 정보와 일치하지 않습니다.");
    const product = await getAddonProduct(db, order.productCode);
    const approvedAt = payment.approvedAt ? new Date(payment.approvedAt) : new Date();
    await db.begin(async (tx) => {
      const locked = await tx`select status from shorts_mvp.billing_orders where id=${order.id} for update`;
      if (locked[0]?.status === "succeeded") return;
      await tx`
        insert into shorts_mvp.usage_grants (
          user_id,subscription_id,billing_order_id,kind,product_code,total_seconds,valid_from,expires_at
        ) values (
          ${session.userId},${order.subscriptionId},${order.id},'addon',${product.code},${product.seconds},
          ${approvedAt},${approvedAt}+${product.validityDays}*interval '1 day'
        ) on conflict (billing_order_id) where kind='addon' do nothing
      `;
      await tx`
        update shorts_mvp.billing_orders
        set status='succeeded',payment_key=${payment.paymentKey},provider_status=${payment.status},
          approved_at=${approvedAt},failure_code=null,failure_message=null
        where id=${order.id}
      `;
      await tx`
        update shorts_mvp.billing_attempts
        set status='succeeded',payment_key=${payment.paymentKey},finished_at=now()
        where id=${billingAttemptId}
      `;
    });
    return NextResponse.json({ ok: true, orderId: order.orderId, addedSeconds: product.seconds });
  } catch (error) {
    if (checkoutId && claimedOrder) {
      try {
        const status = providerPaymentCompleted || (error instanceof TossApiError && error.outcomeUnknown) ? "unknown" : "failed";
        const code = error instanceof TossApiError ? error.code : error instanceof HttpError ? `HTTP_${error.status}` : "CONFIRM_FAILED";
        const db = getDb();
        await db.begin(async (tx) => {
          await tx`
            update shorts_mvp.billing_orders
            set status=${status},failure_code=${code},failure_message=${error instanceof Error ? error.message.slice(0,300) : null}
            where id=${checkoutId} and status in ('pending','processing')
          `;
          if (billingAttemptId) {
            await tx`
              update shorts_mvp.billing_attempts
              set status=${status === "unknown" ? "unknown" : "failed"},provider_code=${code},finished_at=now()
              where id=${billingAttemptId} and status='processing'
            `;
          }
        });
      } catch {
        // Keep the original confirmation error.
      }
    }
    return apiError(error, "추가 시간 결제를 완료하지 못했습니다.");
  }
}
