import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  addKstMonths,
  createBaseUsageGrant,
  createBillingOrderId,
  extendMonthlyEntitlement,
  getAddonProduct,
  getPaidPlan,
  syncCachedPlan,
} from "@/lib/billing";
import {
  getReconcilableRemediationByMethod,
  LEGACY_CARD_EXPECTED_AMOUNT_KRW,
  type PaymentMethodRemediationRow,
} from "@/lib/billing-payment-method-remediation";
import { getDb } from "@/lib/db";
import { setDefaultPaymentMethod } from "@/lib/default-payment-method";
import {
  cardTokenHash,
  changeThePayOneCardStatus,
  createPaymentTrackId,
  isKnownThePayOneMerchantTerminal,
  parseThePayOneWebhook,
  thePayOneCardTypeAllowsInstallment,
  thePayOneCredentialScopeForMerchantTerminal,
  thePayOneWebhookSecret,
  type ThePayOneWebhookNotification,
} from "@/lib/thepayone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ack() {
  return new NextResponse("result=0000", {
    status: 200,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

function reject(status: number, message: string) {
  return new NextResponse(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function secureEqual(expected: string, actual: string) {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function eventSummary(
  event: ThePayOneWebhookNotification,
  includeStoredCardReference: boolean,
) {
  return {
    ...(includeStoredCardReference ? { last4: event.last4 } : {}),
    issuer: event.issuer,
    acquirer: event.acquirer,
    cardType: event.cardType,
    authCode: event.authCode,
    capType: event.capType,
    transactionDay: event.transactionDay,
    registeredDay: event.registeredDay,
    registeredTime: event.registeredTime,
    rootTransactionId: event.rootTransactionId,
    installmentMonths: event.installmentMonths,
  };
}

async function setManualReview(
  eventId: string,
  reason: string,
  orderId?: string | null,
  subscriptionId?: string | null,
  forceOrderReview = false,
) {
  const db = getDb();
  await db.begin(async (tx) => {
    await tx`
      update shorts_mvp.billing_payment_events
      set validation_status='manual_review',processing_result=${reason},processed_at=now()
      where id=${eventId}
    `;
    if (orderId) await tx`
      update shorts_mvp.billing_orders
      set status='manual_review',failure_code=${reason}
      where id=${orderId}
        and (${forceOrderReview} or status not in ('succeeded','canceled'))
    `;
    if (subscriptionId) await tx`
      update shorts_mvp.user_subscriptions
      set billing_review_status='manual_review',billing_review_reason=${reason}
      where id=${subscriptionId} and status in ('active','past_due')
    `;
  });
}

async function processAddon(
  eventId: string,
  event: ThePayOneWebhookNotification,
  order: Record<string, unknown>,
) {
  const db = getDb();
  const paymentMethodId = typeof order.paymentMethodId === "string"
    ? order.paymentMethodId
    : null;
  if (order.status === "succeeded") {
    await db`
      update shorts_mvp.billing_payment_events
      set billing_order_id=${order.id as string},subscription_id=${order.subscriptionId as string},
        payment_method_id=${paymentMethodId},
        validation_status='processed',processing_result='addon_payment_reconciled',processed_at=now()
      where id=${eventId}
    `;
    return;
  }
  if (order.status !== "pending" && order.status !== "processing") {
    await setManualReview(eventId, "ADDON_ORDER_NOT_PAYABLE", order.id as string, order.subscriptionId as string);
    return;
  }
  const product = await getAddonProduct(db, order.productCode as string);
  const attemptId = randomUUID();
  await db.begin(async (tx) => {
    const locked = await tx`
      select o.*,s.status as subscription_status,s.current_period_end
      from shorts_mvp.billing_orders o
      join shorts_mvp.user_subscriptions s on s.id=o.subscription_id
      where o.id=${order.id as string} for update of o
    `;
    const current = locked[0];
    if (!current) throw new Error("ADDON_ORDER_NOT_FOUND");
    if (current.status === "succeeded") {
      await tx`
        update shorts_mvp.billing_payment_events
        set billing_order_id=${order.id as string},subscription_id=${order.subscriptionId as string},
          payment_method_id=${paymentMethodId},
          validation_status='processed',processing_result='addon_payment_reconciled',processed_at=now()
        where id=${eventId}
      `;
      return;
    }
    if (current.status !== "pending" && current.status !== "processing") {
      throw new Error("ADDON_ORDER_NOT_PAYABLE");
    }
    if (current.subscriptionStatus !== "active" || current.currentPeriodEnd <= new Date()) {
      throw new Error("SUBSCRIPTION_INACTIVE");
    }
    await tx`
      insert into shorts_mvp.billing_attempts (
        id,order_id,attempt_no,provider_order_id,status,provider_transaction_id,provider_code,finished_at
      ) values (
        ${attemptId},${order.id as string},1,${event.transactionId},'succeeded',
        ${event.transactionId},'0000',now()
      ) on conflict (order_id,attempt_no) do nothing
    `;
    await tx`
      update shorts_mvp.billing_attempts
      set status='succeeded',provider_transaction_id=${event.transactionId},
        provider_code='0000',finished_at=now()
      where order_id=${order.id as string} and attempt_no=1
        and status in ('processing','succeeded')
    `;
    await tx`
      insert into shorts_mvp.usage_grants (
        user_id,subscription_id,billing_order_id,kind,product_code,total_seconds,
        credited_seconds,carried_seconds,valid_from,expires_at
      ) values (
        ${order.userId as string},${order.subscriptionId as string},${order.id as string},'addon',
        ${product.code},${product.seconds},${product.seconds},0,
        now(),now()+${product.validityDays}*interval '1 day'
      ) on conflict (billing_order_id) where kind='addon' do nothing
    `;
    await tx`
      update shorts_mvp.billing_orders
      set status='succeeded',provider_transaction_id=${event.transactionId},provider_status='paid',
        provider_card_id_hash=${paymentMethodId ? cardTokenHash(event.cardId) : null},
        approved_at=now(),failure_code=null,failure_message=null
      where id=${order.id as string}
    `;
    await tx`
      update shorts_mvp.billing_payment_events
      set billing_order_id=${order.id as string},subscription_id=${order.subscriptionId as string},
        payment_method_id=${paymentMethodId},
        validation_status='processed',processing_result='addon_granted',processed_at=now()
      where id=${eventId}
    `;
    if (paymentMethodId) {
      await setDefaultPaymentMethod(
        tx,
        order.userId as string,
        paymentMethodId,
      );
    }
  });
}

async function processRecurring(
  eventId: string,
  event: ThePayOneWebhookNotification,
  method: Record<string, unknown>,
) {
  const db = getDb();
  const rows = await db`
    select s.* from shorts_mvp.user_subscriptions s
    where s.payment_method_id=${method.id as string} and s.payment_provider='thepayone'
      and s.status in ('active','past_due')
    order by s.created_at desc limit 1
  `;
  const subscription = rows[0];
  if (!subscription) {
    await setManualReview(eventId, "SUBSCRIPTION_NOT_FOUND", null, null);
    return;
  }
  if (
    method.status !== "active"
    || method.providerScheduleStatus !== "active"
    || subscription.billingCycle !== "monthly"
    || subscription.cancelAtPeriodEnd
    || subscription.scheduledPlanCode
  ) {
    await setManualReview(eventId, "RECURRING_SCHEDULE_NOT_ACTIVE", null, subscription.id);
    return;
  }
  const plan = await getPaidPlan(db, subscription.planCode);
  const remediation = await getReconcilableRemediationByMethod(
    db,
    method.id as string,
  );
  const chargeDueAt = subscription.nextChargeAt as Date | null;
  const baseRecurringMatches = (
    event.installmentMonths === 0
    && cardTokenHash(event.cardId) === method.billingKeyHash
    && event.merchantId === method.providerMerchantId
    && event.terminalId === method.providerTerminalId
  );
  if (remediation) {
    const snapshotMatches = (
      subscription.id === remediation.subscriptionId
      && subscription.planCode === remediation.expectedProductCode
      && Number(plan.monthlyPriceKrw) === Number(remediation.expectedAmountKrw)
      && chargeDueAt?.getTime() === remediation.originalNextChargeAt.getTime()
      && (subscription.currentPeriodEnd as Date).getTime()
        === remediation.originalCurrentPeriodEnd.getTime()
      && Number(subscription.billingAnchorDay) === Number(remediation.billingAnchorDay)
    );
    if (!baseRecurringMatches || !snapshotMatches || !chargeDueAt) {
      await setManualReview(eventId, "REMEDIATION_RECURRING_MISMATCH", null, subscription.id);
      return;
    }
    if (chargeDueAt.getTime() > Date.now() + 72 * 60 * 60 * 1000) {
      await setManualReview(eventId, "REMEDIATION_EVENT_TOO_EARLY", null, subscription.id);
      return;
    }
    if (chargeDueAt.getTime() < Date.now() - 7 * 24 * 60 * 60 * 1000) {
      await setManualReview(eventId, "REMEDIATION_EVENT_TOO_LATE", null, subscription.id);
      return;
    }
    if (event.amount !== LEGACY_CARD_EXPECTED_AMOUNT_KRW) {
      await processAbnormalRemediationRecurring(
        eventId,
        event,
        method,
        subscription,
        remediation,
      );
      return;
    }
  }
  if (
    event.amount !== plan.monthlyPriceKrw
    || event.installmentMonths !== 0
    || cardTokenHash(event.cardId) !== method.billingKeyHash
  ) {
    await setManualReview(eventId, "RECURRING_PAYMENT_MISMATCH", null, subscription.id);
    return;
  }
  const entitlementTail = subscription.currentPeriodEnd as Date;
  if (!chargeDueAt) {
    await setManualReview(eventId, "RECURRING_CHARGE_DATE_MISSING", null, subscription.id);
    return;
  }
  if (chargeDueAt.getTime() > Date.now() + 72 * 60 * 60 * 1000) {
    await setManualReview(eventId, "RECURRING_EVENT_TOO_EARLY", null, subscription.id);
    return;
  }
  if (chargeDueAt.getTime() < Date.now() - 7 * 24 * 60 * 60 * 1000) {
    await setManualReview(eventId, "RECURRING_EVENT_TOO_LATE", null, subscription.id);
    return;
  }
  const periodEnd = extendMonthlyEntitlement(
    entitlementTail,
    chargeDueAt,
    Number(subscription.billingAnchorDay),
  );
  const nextChargeAt = addKstMonths(
    chargeDueAt,
    1,
    Number(subscription.billingAnchorDay),
  );
  const internalOrderId = createBillingOrderId("REN");
  await db.begin(async (tx) => {
    const locked = await tx`
      select * from shorts_mvp.user_subscriptions where id=${subscription.id} for update
    `;
    if (
      !locked[0]
      || locked[0].currentPeriodEnd.getTime() !== entitlementTail.getTime()
      || locked[0].nextChargeAt?.getTime() !== chargeDueAt.getTime()
    ) {
      await tx`
        update shorts_mvp.billing_payment_events
        set subscription_id=${subscription.id},payment_method_id=${method.id as string},
          validation_status='manual_review',processing_result='RENEWAL_PERIOD_CHANGED',processed_at=now()
        where id=${eventId}
      `;
      if (locked[0]) await tx`
        update shorts_mvp.user_subscriptions
        set billing_review_status='manual_review',billing_review_reason='RENEWAL_PERIOD_CHANGED'
        where id=${subscription.id}
      `;
      return;
    }
    const orders = await tx`
      insert into shorts_mvp.billing_orders (
        user_id,subscription_id,payment_method_id,request_id,kind,product_code,billing_cycle,
        amount_krw,order_id,order_name,status,provider,provider_track_id,provider_transaction_id,
        provider_status,provider_merchant_id,provider_terminal_id,provider_card_id_hash,
        renewal_period_start,approved_at,provider_auth_code,provider_transaction_day,installment_months
      ) values (
        ${subscription.userId},${subscription.id},${method.id as string},${randomUUID()},
        'subscription_renewal',${plan.code},'monthly',${event.amount},${internalOrderId},
        ${`Easy Cut ${plan.displayName} 월간 구독 갱신`},'succeeded','thepayone',${event.trackId},
        ${event.transactionId},'paid',${event.merchantId},${event.terminalId},${cardTokenHash(event.cardId)},
        ${chargeDueAt},now(),${event.authCode},
        ${event.transactionDay && /^\d{8}$/.test(event.transactionDay) ? `${event.transactionDay.slice(0, 4)}-${event.transactionDay.slice(4, 6)}-${event.transactionDay.slice(6, 8)}` : null},
        0
      ) on conflict (subscription_id,renewal_period_start)
        where kind='subscription_renewal' and renewal_period_start is not null
      do nothing returning id
    `;
    if (!orders[0]) {
      await tx`
        update shorts_mvp.billing_payment_events
        set subscription_id=${subscription.id},payment_method_id=${method.id as string},
          validation_status='manual_review',processing_result='DUPLICATE_RENEWAL_PERIOD',processed_at=now()
        where id=${eventId}
      `;
      await tx`
        update shorts_mvp.user_subscriptions
        set billing_review_status='manual_review',billing_review_reason='DUPLICATE_RENEWAL_PERIOD'
        where id=${subscription.id}
      `;
      return;
    }
    await tx`
      insert into shorts_mvp.billing_attempts (
        order_id,attempt_no,provider_order_id,status,provider_transaction_id,provider_code,finished_at
      ) values (
        ${orders[0].id},1,${event.transactionId},'succeeded',${event.transactionId},'0000',now()
      )
    `;
    const quotaEnd = await createBaseUsageGrant({
      db: tx,
      userId: subscription.userId,
      subscriptionId: subscription.id,
      billingOrderId: orders[0].id,
      plan,
      validFrom: chargeDueAt,
      subscriptionEnd: periodEnd,
    });
    await tx`
      update shorts_mvp.user_subscriptions
      set status='active',current_period_start=${chargeDueAt},current_period_end=${periodEnd},
        next_charge_at=${nextChargeAt},next_quota_at=${quotaEnd},next_retry_at=null,grace_ends_at=null,
        retry_count=0,provider_schedule_status='active',billing_review_status='clear',
        billing_review_reason=null,last_provider_event_at=now()
      where id=${subscription.id}
    `;
    await tx`
      update shorts_mvp.billing_payment_events
      set billing_order_id=${orders[0].id},subscription_id=${subscription.id},
        payment_method_id=${method.id as string},validation_status='processed',
        processing_result='subscription_renewed',processed_at=now()
      where id=${eventId}
    `;
    if (remediation) {
      await tx`
        update shorts_mvp.billing_payment_methods
        set registration_amount_krw=${LEGACY_CARD_EXPECTED_AMOUNT_KRW},
          registration_billing_day=${remediation.billingAnchorDay}
        where id=${method.id as string}
      `;
      await tx`
        update shorts_mvp.billing_payment_method_remediations
        set state='completed',resolution='provider_9900_renewal',completed_at=now(),
          last_error_code=null,last_error_message=null
        where id=${remediation.id}
          and state in ('required','registering','awaiting_provider')
      `;
    }
    await setDefaultPaymentMethod(
      tx,
      subscription.userId as string,
      method.id as string,
    );
    await syncCachedPlan(tx, subscription.userId, plan.code);
  });
}

async function processAbnormalRemediationRecurring(
  eventId: string,
  event: ThePayOneWebhookNotification,
  method: Record<string, unknown>,
  subscription: Record<string, unknown>,
  remediation: PaymentMethodRemediationRow,
) {
  const db = getDb();
  const zeroAmount = event.amount === 0;
  const paused = await changeThePayOneCardStatus(
    event.cardId,
    "중지",
    createPaymentTrackId("AUDT"),
  ).then(() => true).catch(() => false);
  const reason = zeroAmount
    ? paused ? "provider_zero_event" : "PROVIDER_ZERO_EVENT_PAUSE_FAILED"
    : paused ? "provider_wrong_amount" : "PROVIDER_WRONG_AMOUNT_PAUSE_FAILED";
  await db.begin(async (tx) => {
    const lockedRows = await tx`
      select r.state,s.status,s.payment_method_id
      from shorts_mvp.billing_payment_method_remediations r
      join shorts_mvp.user_subscriptions s on s.id=r.subscription_id
      where r.id=${remediation.id}
      for update of r,s
    `;
    const locked = lockedRows[0];
    if (!locked || !["required", "registering", "awaiting_provider"].includes(locked.state)) {
      await tx`
        update shorts_mvp.billing_payment_events
        set subscription_id=${subscription.id as string},payment_method_id=${method.id as string},
          validation_status='manual_review',processing_result='REMEDIATION_STATE_CHANGED',processed_at=now()
        where id=${eventId}
      `;
      return;
    }
    await tx`
      update shorts_mvp.billing_payment_methods
      set status=${paused ? "paused" : "manual_review"},
        provider_schedule_status=${paused ? "paused" : "manual_review"},
        payer_tel_ciphertext=null,payer_tel_iv=null,payer_tel_tag=null
      where id=${method.id as string}
    `;
    await tx`
      update shorts_mvp.app_users
      set default_payment_method_id=null
      where id=${subscription.userId as string}
        and default_payment_method_id=${method.id as string}
    `;
    await tx`
      update shorts_mvp.user_subscriptions
      set status='expired',ended_at=now(),payment_method_id=null,
        next_charge_at=null,next_retry_at=null,next_quota_at=null,grace_ends_at=null,
        retry_count=0,provider_schedule_status=${paused ? "paused" : "manual_review"},
        billing_review_status=${paused && zeroAmount ? "clear" : "manual_review"},
        billing_review_reason=${paused && zeroAmount ? null : reason},
        last_provider_event_at=now()
      where id=${subscription.id as string} and status in ('active','past_due')
    `;
    await tx`
      update shorts_mvp.billing_payment_method_remediations
      set state=${zeroAmount && paused ? "expired" : "manual_review"},
        resolution=${zeroAmount ? "provider_zero_event" : "provider_wrong_amount"},
        expired_at=${zeroAmount ? new Date() : null},
        last_error_code=${zeroAmount && paused ? null : reason},
        last_error_message=${zeroAmount && paused ? null : "기존 정기결제 결과를 수동으로 확인해야 합니다."}
      where id=${remediation.id}
    `;
    await tx`
      update shorts_mvp.billing_payment_events
      set subscription_id=${subscription.id as string},payment_method_id=${method.id as string},
        validation_status=${zeroAmount && paused ? "processed" : "manual_review"},
        processing_result=${reason},processed_at=now()
      where id=${eventId}
    `;
    await syncCachedPlan(tx, subscription.userId as string, "free");
  });
}

async function processRefundNotification(
  eventId: string,
  event: ThePayOneWebhookNotification,
) {
  const db = getDb();
  const rows = await db`
    select r.*,o.provider_transaction_id as root_transaction_id,
      o.provider_merchant_id,o.provider_terminal_id,o.provider_card_id_hash,
      o.subscription_id,o.payment_method_id
    from shorts_mvp.admin_billing_refunds r
    join shorts_mvp.billing_orders o on o.id=r.billing_order_id
    where r.provider='thepayone' and r.provider_track_id=${event.trackId}
    limit 1
  `;
  const refund = rows[0];
  if (!refund) {
    const upgradeRefundRows = await db`
      select r.*,o.provider_merchant_id,o.provider_terminal_id,o.provider_card_id_hash,
        o.subscription_id,o.payment_method_id,o.refunded_amount_krw,o.amount_krw
      from shorts_mvp.subscription_upgrade_refunds r
      join shorts_mvp.billing_orders o on o.id=r.source_order_id
      where r.source_provider_transaction_id=${event.rootTransactionId || ""}
        and r.refund_amount_krw=${event.amount}
        and r.status in ('pending','submitted','completed','manual_review')
      order by r.created_at
      limit 2
    `;
    if (upgradeRefundRows.length === 1) {
      const queued = upgradeRefundRows[0];
      const mismatch = queued.providerMerchantId !== event.merchantId
        || queued.providerTerminalId !== event.terminalId
        || (queued.providerCardIdHash && queued.providerCardIdHash !== cardTokenHash(event.cardId))
        || (queued.providerRefundTransactionId && queued.providerRefundTransactionId !== event.transactionId);
      if (mismatch) {
        await setManualReview(eventId, "UPGRADE_REFUND_MISMATCH", queued.sourceOrderId, queued.subscriptionId);
        await db`
          update shorts_mvp.subscription_upgrade_refunds set status='manual_review'
          where id=${queued.id} and status <> 'completed'
        `;
        return;
      }
      await db.begin(async (tx) => {
        const lockedRows = await tx`
          select * from shorts_mvp.subscription_upgrade_refunds where id=${queued.id} for update
        `;
        const locked = lockedRows[0];
        if (!locked) throw new Error("UPGRADE_REFUND_MISSING");
        if (locked.status !== "completed") {
          await tx`
            update shorts_mvp.subscription_upgrade_refunds
            set status='completed',completed_at=now(),
              provider_refund_transaction_id=${event.transactionId},
              provider_reference=coalesce(provider_reference,${event.transactionId})
            where id=${queued.id}
          `;
          await tx`
            update shorts_mvp.billing_orders
            set refunded_amount_krw=refunded_amount_krw+${event.amount},
              refund_status=case
                when refunded_amount_krw+${event.amount} >= amount_krw then 'full'
                else 'partial'
              end,
              proration_refund_transaction_id=${event.transactionId},
              proration_refund_status='succeeded'
            where id=${queued.sourceOrderId}
              and proration_refund_status in ('pending','manual_review')
          `;
        }
        await tx`
          update shorts_mvp.billing_payment_events
          set billing_order_id=${queued.sourceOrderId},subscription_id=${queued.subscriptionId || null},
            payment_method_id=${queued.paymentMethodId || null},validation_status='processed',
            processing_result='upgrade_refund_reconciled',processed_at=now()
          where id=${eventId}
        `;
      });
      return;
    }
    if (upgradeRefundRows.length > 1) {
      await setManualReview(eventId, "AMBIGUOUS_UPGRADE_REFUND");
      return;
    }
    const prorationRows = await db`
      select * from shorts_mvp.billing_orders
      where provider='thepayone' and proration_refund_track_id=${event.trackId}
      order by created_at desc limit 1
    `;
    const order = prorationRows[0];
    if (!order) {
      await setManualReview(eventId, "UNMATCHED_REFUND_TRACK_ID");
      return;
    }
    const mismatch = Number(order.prorationCreditKrw) !== event.amount
      || (event.rootTransactionId && order.providerTransactionId !== event.rootTransactionId)
      || order.providerMerchantId !== event.merchantId
      || order.providerTerminalId !== event.terminalId
      || (order.providerCardIdHash && order.providerCardIdHash !== cardTokenHash(event.cardId))
      || (order.prorationRefundTransactionId && order.prorationRefundTransactionId !== event.transactionId);
    if (mismatch) {
      await setManualReview(eventId, "PRORATION_REFUND_MISMATCH", order.id, order.subscriptionId);
      return;
    }
    await db.begin(async (tx) => {
      await tx`
        update shorts_mvp.billing_orders
        set proration_refund_transaction_id=coalesce(proration_refund_transaction_id,${event.transactionId}),
          proration_refund_status='succeeded',refunded_amount_krw=${event.amount},
          refund_status=${event.amount === Number(order.amountKrw) ? "full" : "partial"}
        where id=${order.id} and proration_refund_status in ('pending','succeeded')
      `;
      await tx`
        update shorts_mvp.billing_payment_events
        set billing_order_id=${order.id},subscription_id=${order.subscriptionId || null},
          payment_method_id=${order.paymentMethodId || null},validation_status='processed',
          processing_result='proration_refund_reconciled',processed_at=now()
        where id=${eventId}
      `;
    });
    return;
  }
  const mismatch = Number(refund.amountKrw) !== event.amount
    || (event.rootTransactionId && refund.rootTransactionId !== event.rootTransactionId)
    || refund.providerMerchantId !== event.merchantId
    || refund.providerTerminalId !== event.terminalId
    || (refund.providerCardIdHash && refund.providerCardIdHash !== cardTokenHash(event.cardId))
    || (refund.providerRefundTransactionId && refund.providerRefundTransactionId !== event.transactionId);
  if (mismatch) {
    await setManualReview(eventId, "REFUND_NOTIFICATION_MISMATCH", refund.billingOrderId, refund.subscriptionId);
    await db`
      update shorts_mvp.admin_billing_refunds
      set status='manual_review',failure_message='REFUND_NOTIFICATION_MISMATCH'
      where id=${refund.id} and status <> 'succeeded'
    `;
    return;
  }
  if (refund.status === "succeeded") {
    await db`
      update shorts_mvp.billing_payment_events
      set billing_order_id=${refund.billingOrderId},subscription_id=${refund.subscriptionId || null},
        payment_method_id=${refund.paymentMethodId || null},validation_status='processed',
        processing_result='admin_refund_reconciled',processed_at=now()
      where id=${eventId}
    `;
    return;
  }
  if (refund.status === "processing") {
    await db`
      update shorts_mvp.billing_payment_events
      set billing_order_id=${refund.billingOrderId},subscription_id=${refund.subscriptionId || null},
        payment_method_id=${refund.paymentMethodId || null},validation_status='validated',
        processing_result='awaiting_refund_confirmation'
      where id=${eventId}
    `;
    return;
  }
  await setManualReview(eventId, "REFUND_STATE_REQUIRES_REVIEW", refund.billingOrderId, refund.subscriptionId);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ secret: string }> },
) {
  const { secret } = await context.params;
  let expectedSecret: string;
  try {
    expectedSecret = thePayOneWebhookSecret();
  } catch {
    return reject(503, "Webhook unavailable");
  }
  if (!secureEqual(expectedSecret, secret)) return reject(404, "Not found");
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return reject(415, "Unsupported content type");
  }

  let event: ThePayOneWebhookNotification;
  try {
    event = parseThePayOneWebhook(await request.text());
  } catch {
    return reject(400, "Invalid notification");
  }

  const db = getDb();
  const eventId = randomUUID();
  let eventCredentialScope: "default" | "manual" | "package" | null = null;
  try {
    eventCredentialScope = thePayOneCredentialScopeForMerchantTerminal(
      event.merchantId,
      event.terminalId,
    );
  } catch {
    // The event is still recorded for fraud/reconciliation review without a card reference.
  }
  const includeStoredCardReference = eventCredentialScope === "default";
  const inserted = await db`
    insert into shorts_mvp.billing_payment_events (
      id,provider,provider_transaction_id,merchant_id,terminal_id,track_id,card_id_hash,
      transaction_type,amount_krw,event_summary
    ) values (
      ${eventId},'thepayone',${event.transactionId},${event.merchantId},${event.terminalId},
      ${event.trackId},${includeStoredCardReference ? cardTokenHash(event.cardId) : null},
      ${event.transactionType},${event.amount},
      ${JSON.stringify(eventSummary(event, includeStoredCardReference))}::jsonb
    ) on conflict (provider,provider_transaction_id) do nothing returning id
  `;
  if (!inserted[0]) return ack();

  try {
    if (!isKnownThePayOneMerchantTerminal(event.merchantId, event.terminalId)) {
      await setManualReview(eventId, "MERCHANT_OR_TERMINAL_MISMATCH");
      return ack();
    }
    if (event.transactionType === "refund") {
      await processRefundNotification(eventId, event);
      return ack();
    }

    const orders = await db`
      select * from shorts_mvp.billing_orders
      where provider='thepayone' and provider_track_id=${event.trackId} and order_id=${event.trackId}
      order by created_at desc limit 1
    `;
    const order = orders[0];
    if (order) {
      const expectedCardHash = order.providerCardIdHash as string | null;
      const mismatch = Number(order.amountKrw) !== event.amount
        || order.providerMerchantId !== event.merchantId
        || order.providerTerminalId !== event.terminalId
        || (expectedCardHash && expectedCardHash !== cardTokenHash(event.cardId))
        || (order.providerTransactionId && order.providerTransactionId !== event.transactionId)
        || Number(order.installmentMonths || 0) !== event.installmentMonths
        || !thePayOneCardTypeAllowsInstallment(
          event.cardType,
          Number(order.installmentMonths || 0),
        );
      if (mismatch) {
        await setManualReview(
          eventId,
          "ORDER_PAYMENT_MISMATCH",
          order.id,
          order.subscriptionId,
          true,
        );
        return ack();
      }
      await db`
        update shorts_mvp.billing_payment_events
        set billing_order_id=${order.id},subscription_id=${order.subscriptionId || null},
          payment_method_id=${order.paymentMethodId || null},validation_status='validated'
        where id=${eventId}
      `;
      await db`
        update shorts_mvp.billing_orders
        set provider_auth_code=coalesce(provider_auth_code,${event.authCode}),
          provider_transaction_day=coalesce(
            provider_transaction_day,
            case when ${event.transactionDay || ""} ~ '^[0-9]{8}$'
              then to_date(${event.transactionDay || ""},'YYYYMMDD') else null end
          ),
          installment_months=${event.installmentMonths}
        where id=${order.id}
      `;
      if (order.kind === "addon") {
        try {
          await processAddon(eventId, event, order);
        } catch {
          await setManualReview(eventId, "ADDON_GRANT_FAILED", order.id, order.subscriptionId);
        }
        return ack();
      }
      if (order.status === "succeeded") {
        await db`
          update shorts_mvp.billing_payment_events
          set validation_status='processed',processing_result='server_payment_reconciled',processed_at=now()
          where id=${eventId}
        `;
      } else if (order.status === "processing") {
        await db`
          update shorts_mvp.billing_payment_events
          set processing_result='awaiting_server_confirmation'
          where id=${eventId}
        `;
      } else {
        await setManualReview(eventId, "ORDER_STATE_REQUIRES_REVIEW", order.id, order.subscriptionId);
      }
      return ack();
    }

    const methods = await db`
      select * from shorts_mvp.billing_payment_methods
      where provider='thepayone' and registration_order_id=${event.trackId}
      order by created_at desc limit 1
    `;
    if (!methods[0]) {
      await setManualReview(eventId, "UNMATCHED_TRACK_ID");
      return ack();
    }
    await db`
      update shorts_mvp.billing_payment_events
      set payment_method_id=${methods[0].id},validation_status='validated'
      where id=${eventId}
    `;
    await processRecurring(eventId, event, methods[0]);
    return ack();
  } catch {
    await setManualReview(eventId, "WEBHOOK_PROCESSING_FAILED").catch(() => undefined);
    return ack();
  }
}

export async function GET() {
  return reject(405, "POST required");
}
