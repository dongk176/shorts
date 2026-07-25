import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createBaseUsageGrant,
  createBillingOrderId,
  extendMonthlyEntitlement,
  getPaidPlan,
  nextMonthlyChargeAfterResume,
  syncCachedPlan,
} from "@/lib/billing";
import { decryptBillingPhone } from "@/lib/billing-phone";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { setDefaultPaymentMethod } from "@/lib/default-payment-method";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import {
  assertThePayOneBillingEnabled,
  cardTokenHash,
  changeThePayOneCardStatus,
  chargeThePayOneCard,
  createPaymentTrackId,
  decryptCardToken,
  thePayOneMerchantId,
  thePayOneTerminalId,
  ThePayOneError,
} from "@/lib/thepayone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  requestId: z.string().uuid(),
  expectedChargeAmountKrw: z.number().int().positive(),
  identityNumber: z.string()
    .transform((value) => value.replace(/[^0-9]/g, ""))
    .refine((value) => /^(\d{6}|\d{10})$/.test(value)),
  cardPassword: z.string().refine((value) => /^\d{2}$/.test(value)),
  consent: z.literal(true),
}).strict();

function kstTransactionDay(date: Date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function safeFailureMessage(error: unknown) {
  if (!(error instanceof Error)) return null;
  return error.message.replace(/(?:\d[ -]?){6,19}/g, "[민감정보 숨김]").slice(0, 300);
}

export async function POST(request: Request) {
  let orderDatabaseId: string | null = null;
  let attemptId: string | null = null;
  let subscriptionId: string | null = null;
  let paymentMethodId: string | null = null;
  let scheduleEnabled = false;
  let providerPaymentCompleted = false;
  let cardId: string | null = null;
  try {
    assertBillingMutationRequest(request);
    assertThePayOneBillingEnabled();
    const input = schema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    if (!session.user?.email) {
      throw new HttpError(409, "결제에 사용할 계정 이메일을 확인할 수 없습니다.");
    }
    const db = getDb();
    const rows = await db`
      select s.*,m.id as selected_payment_method_id,m.provider,m.status as method_status,
        m.provider_schedule_status as method_schedule_status,
        m.billing_key_ciphertext,m.billing_key_iv,m.billing_key_tag,
        m.billing_key_hash,m.payer_tel_ciphertext,m.payer_tel_iv,m.payer_tel_tag
      from shorts_mvp.user_subscriptions s
      join shorts_mvp.app_users u on u.id=s.user_id
      join shorts_mvp.billing_payment_methods m
        on m.id=coalesce(u.default_payment_method_id,s.payment_method_id)
       and m.user_id=u.id
      where s.user_id=${session.userId}
        and s.plan_code='easycut_pro_v2'
        and s.billing_cycle='monthly'
        and s.status='active'
        and s.cancel_at_period_end
        and s.current_period_end > clock_timestamp()
        and s.next_charge_at is not null
      order by s.created_at desc
      limit 1
    `;
    const subscription = rows[0];
    if (!subscription) {
      throw new HttpError(
        409,
        "다시 시작할 수 있는 해지 예정 월간 구독을 찾지 못했습니다.",
        "RESUBSCRIPTION_NOT_AVAILABLE",
      );
    }
    if (
      subscription.provider !== "thepayone"
      || !subscription.selectedPaymentMethodId
      || !subscription.billingKeyCiphertext
      || !subscription.billingKeyIv
      || !subscription.billingKeyTag
      || !subscription.payerTelCiphertext
      || !subscription.payerTelIv
      || !subscription.payerTelTag
      || ["disposed", "revoked", "replaced", "manual_review"].includes(subscription.methodStatus)
    ) {
      throw new HttpError(
        409,
        "저장된 결제수단을 다시 사용할 수 없습니다. 새 카드로 구독해 주세요.",
        "PAYMENT_METHOD_REQUIRED",
      );
    }
    const competing = await db`
      select id from shorts_mvp.user_subscriptions
      where user_id=${session.userId} and billing_cycle='monthly'
        and status in ('pending','trialing','active','past_due')
        and not cancel_at_period_end and id<>${subscription.id}
      limit 1
    `;
    if (competing[0]) {
      throw new HttpError(409, "이미 자동갱신 중인 월간 구독이 있습니다.");
    }

    const plan = await getPaidPlan(db, "easycut_pro_v2");
    if (input.expectedChargeAmountKrw !== plan.monthlyPriceKrw) {
      throw new HttpError(
        409,
        "확인한 뒤 결제금액이 변경되었습니다. 금액을 다시 확인해 주세요.",
        "PAYMENT_QUOTE_CHANGED",
      );
    }
    subscriptionId = subscription.id;
    const storedPaymentMethodId = String(subscription.selectedPaymentMethodId);
    paymentMethodId = storedPaymentMethodId;
    cardId = decryptCardToken({
      ciphertext: subscription.billingKeyCiphertext,
      iv: subscription.billingKeyIv,
      tag: subscription.billingKeyTag,
    }, storedPaymentMethodId);
    const payerTel = decryptBillingPhone({
      ciphertext: subscription.payerTelCiphertext,
      iv: subscription.payerTelIv,
      tag: subscription.payerTelTag,
    }, storedPaymentMethodId);
    const payerName = (
      session.user.displayName
      || session.user.email.split("@", 1)[0]
      || "Easy Cut 고객"
    ).slice(0, 20);
    const billingDay = String(
      Math.max(1, Math.min(28, Number(subscription.billingAnchorDay) || 1)),
    ).padStart(2, "0");
    const merchantId = thePayOneMerchantId();
    const terminalId = thePayOneTerminalId();
    const orderId = createBillingOrderId("REN");
    const inserted = await db`
      insert into shorts_mvp.billing_orders (
        user_id,subscription_id,payment_method_id,request_id,kind,product_code,billing_cycle,
        amount_krw,order_id,order_name,provider,provider_track_id,
        provider_merchant_id,provider_terminal_id,provider_card_id_hash,
        installment_months,checkout_expires_at
      ) values (
        ${session.userId},${subscription.id},${paymentMethodId},${input.requestId},
        'subscription_change',${plan.code},'monthly',${plan.monthlyPriceKrw},
        ${orderId},${`Easy Cut ${plan.displayName} 다시 구독`},'thepayone',${orderId},
        ${merchantId},${terminalId},${cardTokenHash(cardId)},0,now()+interval '10 minutes'
      ) on conflict do nothing returning *
    `;
    const order = inserted[0] || (await db`
      select * from shorts_mvp.billing_orders
      where user_id=${session.userId} and request_id=${input.requestId}
      limit 1
    `)[0];
    if (!order) {
      throw new HttpError(
        409,
        "다시 구독 결제가 이미 진행 중입니다. 잠시 후 결제 내역을 확인해 주세요.",
        "RESUBSCRIPTION_IN_PROGRESS",
      );
    }
    orderDatabaseId = order.id;
    if (order.status === "succeeded") {
      return NextResponse.json({
        ok: true,
        checkoutId: order.id,
        orderId: order.orderId,
        alreadyProcessed: true,
      });
    }
    if (order.status !== "pending" || order.checkoutExpiresAt <= new Date()) {
      throw new HttpError(409, "결제 요청이 만료되었거나 이미 처리되었습니다.");
    }
    const claimed = await db`
      update shorts_mvp.billing_orders set status='processing'
      where id=${order.id} and status='pending' returning id
    `;
    if (!claimed[0]) throw new HttpError(409, "다른 요청에서 결제를 처리하고 있습니다.");

    const attempts = await db`
      insert into shorts_mvp.billing_attempts (order_id,attempt_no,provider_order_id)
      values (${order.id},1,${order.orderId})
      on conflict (order_id,attempt_no) do nothing returning id
    `;
    attemptId = attempts[0]?.id || null;
    if (!attemptId) throw new HttpError(409, "같은 결제가 이미 처리 중입니다.");

    await changeThePayOneCardStatus(cardId, "사용", createPaymentTrackId("AUDT"));
    scheduleEnabled = true;
    const payment = await chargeThePayOneCard({
      trackId: order.orderId,
      cardId,
      authDob: input.identityNumber,
      authPw: input.cardPassword,
      amount: plan.monthlyPriceKrw,
      payerName,
      payerEmail: session.user.email,
      payerTel,
      billingDay,
      installmentMonths: 0,
      productName: `Easy Cut ${plan.displayName}`,
      description: "월간 구독 다시 시작",
      referenceId: order.id,
    });
    providerPaymentCompleted = true;
    if (
      payment.trackId !== order.orderId
      || payment.amount !== plan.monthlyPriceKrw
      || payment.cardId !== cardId
      || payment.terminalId !== terminalId
      || payment.installmentMonths !== 0
    ) {
      throw new ThePayOneError(
        "결제 승인 결과가 주문 정보와 일치하지 않습니다.",
        "PAYMENT_MISMATCH",
        null,
        true,
      );
    }

    const originalPeriodEnd = subscription.currentPeriodEnd as Date;
    const originalNextChargeAt = subscription.nextChargeAt as Date;
    const extendedPeriodEnd = extendMonthlyEntitlement(
      originalPeriodEnd,
      payment.approvedAt,
      Number(subscription.billingAnchorDay) || undefined,
    );
    const resumedNextChargeAt = nextMonthlyChargeAfterResume(
      originalNextChargeAt,
      payment.approvedAt,
      Number(subscription.billingAnchorDay) || undefined,
    );
    await db.begin(async (tx) => {
      const lockedRows = await tx`
        select * from shorts_mvp.user_subscriptions
        where id=${subscription.id} and user_id=${session.userId}
        for update
      `;
      const locked = lockedRows[0];
      if (
        !locked
        || !locked.cancelAtPeriodEnd
        || locked.currentPeriodEnd.getTime() !== originalPeriodEnd.getTime()
        || locked.nextChargeAt?.getTime() !== originalNextChargeAt.getTime()
      ) {
        throw new HttpError(
          409,
          "구독 상태가 변경되어 결제 결과를 자동 적용하지 못했습니다.",
          "RESUBSCRIPTION_STATE_CHANGED",
        );
      }
      const quotaEnd = await createBaseUsageGrant({
        db: tx,
        userId: session.userId,
        subscriptionId: subscription.id,
        billingOrderId: order.id,
        plan,
        validFrom: payment.approvedAt,
        subscriptionEnd: extendedPeriodEnd,
      });
      await tx`
        update shorts_mvp.user_subscriptions
        set cancel_at_period_end=false,canceled_at=null,
          payment_method_id=${paymentMethodId},payment_provider='thepayone',
          current_period_end=${extendedPeriodEnd},
          next_charge_at=${resumedNextChargeAt},next_quota_at=${quotaEnd},
          next_retry_at=null,grace_ends_at=null,retry_count=0,
          provider_schedule_status='active',billing_review_status='clear',
          billing_review_reason=null,last_provider_event_at=now()
        where id=${subscription.id}
      `;
      await tx`
        update shorts_mvp.billing_payment_methods
        set status='active',provider_schedule_status='active'
        where id=${paymentMethodId}
      `;
      await tx`
        update shorts_mvp.billing_orders
        set status='succeeded',provider_transaction_id=${payment.providerTransactionId},
          provider_status='paid',provider_auth_code=${payment.authCode},
          provider_transaction_day=${kstTransactionDay(payment.approvedAt)},
          provider_terminal_id=${payment.terminalId},approved_at=${payment.approvedAt},
          failure_code=null,failure_message=null
        where id=${order.id} and status='processing'
      `;
      await tx`
        update shorts_mvp.billing_attempts
        set status='succeeded',provider_transaction_id=${payment.providerTransactionId},
          provider_code='0000',finished_at=now()
        where id=${attemptId}
      `;
      await tx`
        update shorts_mvp.billing_payment_events
        set billing_order_id=${order.id},subscription_id=${subscription.id},
          payment_method_id=${paymentMethodId},validation_status='processed',
          processing_result='subscription_resubscribed',processed_at=now()
        where provider='thepayone'
          and provider_transaction_id=${payment.providerTransactionId}
          and validation_status in ('received','validated')
      `;
      await setDefaultPaymentMethod(
        tx,
        session.userId,
        paymentMethodId!,
      );
      await syncCachedPlan(tx, session.userId, plan.code);
    });
    return NextResponse.json({
      ok: true,
      checkoutId: order.id,
      orderId: order.orderId,
      chargedAmountKrw: plan.monthlyPriceKrw,
      addedMinutes: Math.floor(plan.monthlySourceSeconds / 60),
      nextChargeAt: resumedNextChargeAt.toISOString(),
      accessUntil: extendedPeriodEnd.toISOString(),
    });
  } catch (error) {
    const unknown = providerPaymentCompleted
      || (error instanceof ThePayOneError && error.outcomeUnknown);
    if (scheduleEnabled && cardId) {
      await changeThePayOneCardStatus(
        cardId,
        "중지",
        createPaymentTrackId("AUDT"),
      ).catch(() => undefined);
    }
    if (orderDatabaseId) {
      await getDb().begin(async (tx) => {
        await tx`
          update shorts_mvp.billing_orders
          set status=${unknown ? "manual_review" : "failed"},
            failure_code=${error instanceof ThePayOneError
              ? error.resultCode
              : error instanceof HttpError ? error.code : "RESUBSCRIPTION_FAILED"},
            failure_message=${safeFailureMessage(error)}
          where id=${orderDatabaseId} and status in ('pending','processing')
        `;
        if (attemptId) await tx`
          update shorts_mvp.billing_attempts
          set status=${unknown ? "unknown" : "failed"},
            provider_code=${error instanceof ThePayOneError ? error.resultCode : "RESUBSCRIPTION_FAILED"},
            finished_at=now()
          where id=${attemptId} and status='processing'
        `;
        if (paymentMethodId) await tx`
          update shorts_mvp.billing_payment_methods
          set status=${unknown ? "manual_review" : "paused"},
            provider_schedule_status=${unknown ? "manual_review" : "paused"}
          where id=${paymentMethodId}
        `;
        if (subscriptionId && unknown) await tx`
          update shorts_mvp.user_subscriptions
          set provider_schedule_status='manual_review',
            billing_review_status='manual_review',
            billing_review_reason='RESUBSCRIPTION_PAYMENT_REVIEW'
          where id=${subscriptionId}
        `;
      }).catch(() => undefined);
    }
    if (error instanceof ThePayOneError && safeFailureMessage(error)) {
      return apiError(
        new HttpError(400, safeFailureMessage(error)!, "THEPAYONE_REJECTED"),
        "월간 구독을 다시 시작하지 못했습니다.",
      );
    }
    return apiError(error, "월간 구독을 다시 시작하지 못했습니다.");
  }
}
