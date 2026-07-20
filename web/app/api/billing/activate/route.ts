import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addKstMonths,
  createBaseUsageGrant,
  getPaidPlan,
  syncCachedPlan,
} from "@/lib/billing";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import {
  billingKeyHash,
  chargeBillingKey,
  decryptBillingKey,
  deleteBillingKey,
  encryptBillingKey,
  issueBillingKey,
  TossApiError,
  tossCardSummary,
} from "@/lib/toss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  checkoutId: z.string().uuid(),
  authKey: z.string().min(1).max(300),
  customerKey: z.string().min(2).max(50),
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
      where id=${body.checkoutId} and user_id=${session.userId}
        and kind in ('subscription_initial','payment_method_update')
      limit 1
    `;
    const order = rows[0];
    if (!order) throw new HttpError(404, "구독 결제 요청을 찾을 수 없습니다.");
    if (order.status === "succeeded") {
      return NextResponse.json({ ok: true, orderId: order.orderId, alreadyProcessed: true });
    }
    if (order.status !== "pending" || !order.checkoutExpiresAt || order.checkoutExpiresAt <= new Date()) {
      throw new HttpError(409, "구독 결제 요청이 만료되었거나 이미 처리되었습니다.");
    }
    if (order.customerKey !== body.customerKey) throw new HttpError(400, "결제 고객 정보가 일치하지 않습니다.");
    const claimed = await db`
      update shorts_mvp.billing_orders set status='processing'
      where id=${order.id} and status='pending'
      returning id
    `;
    if (!claimed[0]) throw new HttpError(409, "다른 요청에서 결제를 처리하고 있습니다.");
    claimedOrder = true;

    const authorization = await issueBillingKey(body.authKey, body.customerKey);
    if (authorization.customerKey !== body.customerKey || !authorization.billingKey) {
      throw new HttpError(502, "발급된 정기결제 정보를 확인하지 못했습니다.");
    }
    const encrypted = encryptBillingKey(authorization.billingKey);
    const card = tossCardSummary(authorization.card);
    const methods = await db`
      insert into shorts_mvp.billing_payment_methods (
        user_id,customer_key,billing_key_ciphertext,billing_key_iv,billing_key_tag,
        billing_key_hash,issuer_code,issuer_name,card_number_masked,card_last4,card_type
      ) values (
        ${session.userId},${body.customerKey},${encrypted.ciphertext},${encrypted.iv},${encrypted.tag},
        ${billingKeyHash(authorization.billingKey)},${card.issuerCode},${card.issuerCode},
        ${card.cardNumberMasked},${card.cardLast4},${card.cardType}
      )
      on conflict (billing_key_hash) do update set updated_at=now()
      returning id
    `;
    const paymentMethodId = methods[0].id;
    const olderMethods = await db`
      select id,billing_key_ciphertext,billing_key_iv,billing_key_tag
      from shorts_mvp.billing_payment_methods
      where user_id=${session.userId} and id<>${paymentMethodId} and status='active'
    `;
    await db`
      update shorts_mvp.billing_orders
      set payment_method_id=${paymentMethodId},failure_code=null,failure_message=null
      where id=${order.id} and status='processing'
    `;

    if (order.kind === "payment_method_update") {
      const previous = await db`
        select m.id,m.billing_key_ciphertext,m.billing_key_iv,m.billing_key_tag
        from shorts_mvp.user_subscriptions s
        left join shorts_mvp.billing_payment_methods m on m.id=s.payment_method_id
        where s.id=${order.subscriptionId} and s.user_id=${session.userId}
          and s.status in ('active','past_due')
        limit 1
      `;
      if (!previous[0]) throw new HttpError(409, "변경할 활성 구독을 찾을 수 없습니다.");
      await db.begin(async (tx) => {
        await tx`
          update shorts_mvp.user_subscriptions
          set payment_method_id=${paymentMethodId},
            next_retry_at=case when status='past_due' then clock_timestamp() else next_retry_at end
          where id=${order.subscriptionId} and user_id=${session.userId}
            and status in ('active','past_due')
        `;
        await tx`
          update shorts_mvp.billing_payment_methods
          set status='replaced',revoked_at=now()
          where user_id=${session.userId} and id<>${paymentMethodId} and status='active'
        `;
        await tx`
          update shorts_mvp.billing_orders
          set status='succeeded',approved_at=now(),provider_status='BILLING_KEY_ISSUED'
          where id=${order.id}
        `;
      });
      for (const oldMethod of olderMethods) {
        try {
          const oldKey = decryptBillingKey({
            ciphertext: oldMethod.billingKeyCiphertext,
            iv: oldMethod.billingKeyIv,
            tag: oldMethod.billingKeyTag,
          });
          await deleteBillingKey(oldKey);
        } catch (error) {
          console.error("toss_old_billing_key_delete_failed", {
            paymentMethodId: oldMethod.id,
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
        }
      }
      return NextResponse.json({ ok: true, orderId: order.orderId, paymentMethodUpdated: true });
    }

    const product = await getPaidPlan(db, order.productCode);
    const attempts = await db`
      insert into shorts_mvp.billing_attempts (order_id,attempt_no,provider_order_id)
      values (${order.id},1,${order.orderId})
      on conflict (order_id,attempt_no) do nothing
      returning id
    `;
    billingAttemptId = attempts[0]?.id || null;
    if (!billingAttemptId) throw new HttpError(409, "구독 결제 승인이 이미 처리 중입니다.");
    const payment = await chargeBillingKey({
      billingKey: authorization.billingKey,
      customerKey: body.customerKey,
      amount: Number(order.amountKrw),
      orderId: order.orderId,
      orderName: order.orderName,
      customerEmail: session.user?.email,
      customerName: session.user?.displayName,
    });
    providerPaymentCompleted = payment.status === "DONE";
    if (
      payment.orderId !== order.orderId
      || payment.totalAmount !== Number(order.amountKrw)
      || payment.status !== "DONE"
    ) {
      throw new HttpError(502, "구독 결제 승인 결과가 주문 정보와 일치하지 않습니다.");
    }
    const periodStart = payment.approvedAt ? new Date(payment.approvedAt) : new Date();
    const periodEnd = addKstMonths(periodStart, order.billingCycle === "yearly" ? 12 : 1);
    let subscriptionId = "";
    await db.begin(async (tx) => {
      const current = await tx`
        select id from shorts_mvp.user_subscriptions
        where user_id=${session.userId} and status in ('pending','trialing','active','past_due')
        for update
      `;
      if (current[0]) throw new HttpError(409, "이미 구독이 활성화되어 있습니다.");
      const subscriptions = await tx`
        insert into shorts_mvp.user_subscriptions (
          user_id,plan_code,status,provider,billing_cycle,payment_method_id,
          current_period_start,current_period_end,next_charge_at,next_quota_at,billing_anchor_day
        ) values (
          ${session.userId},${product.code},'active','toss',${order.billingCycle},${paymentMethodId},
          ${periodStart},${periodEnd},${periodEnd},${addKstMonths(periodStart,1)},
          ${new Date(periodStart.getTime()+9*60*60*1000).getUTCDate()}
        ) returning id
      `;
      subscriptionId = subscriptions[0].id;
      const quotaEnd = await createBaseUsageGrant({
        db: tx,
        userId: session.userId,
        subscriptionId,
        billingOrderId: order.id,
        plan: product,
        validFrom: periodStart,
        subscriptionEnd: periodEnd,
      });
      await tx`
        update shorts_mvp.user_subscriptions set next_quota_at=${quotaEnd}
        where id=${subscriptionId}
      `;
      await tx`
        update shorts_mvp.billing_orders
        set subscription_id=${subscriptionId},status='succeeded',payment_key=${payment.paymentKey},
          provider_status=${payment.status},approved_at=${periodStart},failure_code=null,failure_message=null
        where id=${order.id}
      `;
      await tx`
        update shorts_mvp.billing_attempts
        set status='succeeded',payment_key=${payment.paymentKey},finished_at=now()
        where id=${billingAttemptId}
      `;
      await syncCachedPlan(tx, session.userId, product.code);
      await tx`
        update shorts_mvp.billing_payment_methods set status='replaced',revoked_at=now()
        where user_id=${session.userId} and id<>${paymentMethodId} and status='active'
      `;
    });
    for (const oldMethod of olderMethods) {
      try {
        await deleteBillingKey(decryptBillingKey({
          ciphertext: oldMethod.billingKeyCiphertext,
          iv: oldMethod.billingKeyIv,
          tag: oldMethod.billingKeyTag,
        }));
      } catch (error) {
        console.error("toss_replaced_billing_key_delete_failed", {
          paymentMethodId: oldMethod.id,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
    return NextResponse.json({ ok: true, orderId: order.orderId, subscriptionId, planCode: product.code });
  } catch (error) {
    if (checkoutId && claimedOrder) {
      try {
        const status = providerPaymentCompleted || (error instanceof TossApiError && error.outcomeUnknown) ? "unknown" : "failed";
        const code = error instanceof TossApiError ? error.code : error instanceof HttpError ? `HTTP_${error.status}` : "ACTIVATION_FAILED";
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
        // Preserve the original payment error; reconciliation handles an unknown DB outcome.
      }
    }
    return apiError(error, "구독 결제를 완료하지 못했습니다.");
  }
}
