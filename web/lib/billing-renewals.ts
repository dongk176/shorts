import type { Sql } from "postgres";
import { cleanupExpiredBillingCardVerifications } from "@/lib/billing-card-verifications";
import {
  createBaseUsageGrant,
  getPaidPlan,
  syncCachedPlan,
} from "@/lib/billing";
import {
  getReconcilableRemediationBySubscription,
  legacyCardReconciliationEnabled,
} from "@/lib/billing-payment-method-remediation";
import {
  changeThePayOneCardStatus,
  createPaymentTrackId,
  decryptCardToken,
} from "@/lib/thepayone";
import { isPricingV2PackageCode } from "@/lib/pricing-v2";

function webhookGraceHours() {
  const value = Number(process.env.THEPAYONE_RENEWAL_WEBHOOK_GRACE_HOURS || 6);
  return Number.isFinite(value) && value >= 1 && value <= 48 ? Math.floor(value) : 6;
}

async function pauseSubscriptionSchedule(db: Sql, subscription: Record<string, unknown>) {
  if (
    subscription.paymentProvider !== "thepayone"
    || subscription.billingCycle !== "monthly"
    || subscription.providerScheduleStatus !== "active"
    || !subscription.paymentMethodId
  ) return true;
  const methods = await db`
    select * from shorts_mvp.billing_payment_methods
    where id=${subscription.paymentMethodId as string} and provider='thepayone' limit 1
  `;
  const method = methods[0];
  if (!method) return false;
  try {
    const cardId = decryptCardToken({
      ciphertext: method.billingKeyCiphertext,
      iv: method.billingKeyIv,
      tag: method.billingKeyTag,
    }, method.id);
    await changeThePayOneCardStatus(cardId, "중지", createPaymentTrackId("AUDT"));
    await db`
      update shorts_mvp.billing_payment_methods
      set status='paused',provider_schedule_status='paused'
      where id=${method.id}
    `;
    return true;
  } catch {
    await db`
      update shorts_mvp.billing_payment_methods
      set status='manual_review',provider_schedule_status='manual_review'
      where id=${method.id}
    `;
    return false;
  }
}

async function resumeSubscriptionSchedule(db: Sql, subscription: Record<string, unknown>) {
  if (!subscription.paymentMethodId) return false;
  const methods = await db`
    select * from shorts_mvp.billing_payment_methods
    where id=${subscription.paymentMethodId as string} and provider='thepayone' limit 1
  `;
  const method = methods[0];
  if (!method) return false;
  try {
    const cardId = decryptCardToken({
      ciphertext: method.billingKeyCiphertext,
      iv: method.billingKeyIv,
      tag: method.billingKeyTag,
    }, method.id);
    await changeThePayOneCardStatus(cardId, "사용", createPaymentTrackId("AUDT"));
    await db`
      update shorts_mvp.billing_payment_methods
      set status='active',provider_schedule_status='active'
      where id=${method.id}
    `;
    return true;
  } catch {
    await db`
      update shorts_mvp.billing_payment_methods
      set status='manual_review',provider_schedule_status='manual_review'
      where id=${method.id}
    `;
    return false;
  }
}

async function closeDueSubscription(db: Sql, subscription: Record<string, unknown>) {
  const remediation = await getReconcilableRemediationBySubscription(
    db,
    subscription.id as string,
  );
  if (remediation) {
    const paused = await pauseSubscriptionSchedule(db, subscription);
    const expired = await db.begin(async (tx) => {
      const updated = await tx`
        update shorts_mvp.user_subscriptions
        set status='expired',ended_at=now(),payment_method_id=null,
          next_charge_at=null,next_retry_at=null,next_quota_at=null,grace_ends_at=null,
          retry_count=0,provider_schedule_status=${paused ? "paused" : "manual_review"},
          billing_review_status=${paused ? "clear" : "manual_review"},
          billing_review_reason=${paused ? null : "REMEDIATION_NO_EVENT_PAUSE_FAILED"}
        where id=${subscription.id as string} and status='active'
          and payment_method_id=${remediation.legacyPaymentMethodId}
          and current_period_end=${remediation.originalCurrentPeriodEnd}
          and next_charge_at=${remediation.originalNextChargeAt}
        returning id
      `;
      if (!updated[0]) return false;
      await tx`
        update shorts_mvp.app_users
        set default_payment_method_id=null
        where id=${subscription.userId as string}
          and default_payment_method_id=${subscription.paymentMethodId as string}
      `;
      await tx`
        update shorts_mvp.billing_payment_method_remediations
        set state=${paused ? "expired" : "manual_review"},
          resolution='provider_no_event',expired_at=now(),
          last_error_code=${paused ? null : "REMEDIATION_NO_EVENT_PAUSE_FAILED"},
          last_error_message=${paused ? null : "기존 정기결제 중지 결과를 확인하지 못했습니다."}
        where id=${remediation.id}
          and state in ('required','registering','awaiting_provider')
      `;
      await syncCachedPlan(tx, subscription.userId as string, "free");
      return true;
    });
    if (!expired) {
      const currentRows = await db`
        select state from shorts_mvp.billing_payment_method_remediations
        where id=${remediation.id}
      `;
      const providerRenewalWon = currentRows[0]?.state === "completed";
      const restored = paused && providerRenewalWon
        ? await resumeSubscriptionSchedule(db, subscription)
        : false;
      return restored
        ? "renewal_won_no_event_race"
        : providerRenewalWon ? "manual_review" : "remediation_already_closed";
    }
    return paused ? "remediation_expired_no_event" : "manual_review";
  }
  const paused = await pauseSubscriptionSchedule(db, subscription);
  if (subscription.cancelAtPeriodEnd) {
    await db.begin(async (tx) => {
      await tx`
        update shorts_mvp.user_subscriptions
        set status='canceled',ended_at=now(),next_charge_at=null,next_retry_at=null,next_quota_at=null,
          provider_schedule_status=${paused ? "paused" : "manual_review"},
          billing_review_status=${paused ? "clear" : "manual_review"},
          billing_review_reason=${paused ? null : "SCHEDULE_PAUSE_FAILED"}
        where id=${subscription.id as string} and status='active'
      `;
      if (subscription.paymentMethodId) await tx`
        update shorts_mvp.billing_payment_methods
        set payer_tel_ciphertext=null,payer_tel_iv=null,payer_tel_tag=null
        where id=${subscription.paymentMethodId as string}
      `;
      await syncCachedPlan(tx, subscription.userId as string, "free");
    });
    return paused ? "canceled" : "manual_review";
  }

  await db.begin(async (tx) => {
    await tx`
      update shorts_mvp.user_subscriptions
      set status='past_due',next_charge_at=null,next_retry_at=null,
        grace_ends_at=coalesce(grace_ends_at,clock_timestamp()+interval '7 days'),
        provider_schedule_status=${paused ? "paused" : "manual_review"},
        billing_review_status=${paused ? "clear" : "manual_review"},
        billing_review_reason=${paused ? null : "SCHEDULE_PAUSE_FAILED"}
      where id=${subscription.id as string} and status='active'
    `;
    await syncCachedPlan(tx, subscription.userId as string, "free");
  });
  return paused ? (subscription.scheduledPlanCode ? "change_payment_required" : "payment_required") : "manual_review";
}

async function createDueAnnualQuota(db: Sql, subscriptionId: string) {
  const rows = await db`
    select s.* from shorts_mvp.user_subscriptions s
    where s.id=${subscriptionId} and s.status='active' and s.billing_cycle='yearly'
      and s.next_quota_at <= clock_timestamp() and s.current_period_end > s.next_quota_at
    limit 1
  `;
  const subscription = rows[0];
  if (!subscription) return false;
  const orders = await db`
    select id from shorts_mvp.billing_orders
    where subscription_id=${subscription.id} and status='succeeded'
      and kind in ('subscription_initial','subscription_renewal','subscription_change','annual_renewal')
    order by approved_at desc nulls last limit 1
  `;
  if (!orders[0]) return false;
  const plan = await getPaidPlan(db, subscription.planCode);
  const quotaEnd = await createBaseUsageGrant({
    db,
    userId: subscription.userId,
    subscriptionId: subscription.id,
    billingOrderId: orders[0].id,
    plan,
    validFrom: subscription.nextQuotaAt,
    subscriptionEnd: subscription.currentPeriodEnd,
    billingAnchorDay: Number(subscription.billingAnchorDay),
    carryUntilSubscriptionEnd: isPricingV2PackageCode(plan.code),
  });
  await db`update shorts_mvp.user_subscriptions set next_quota_at=${quotaEnd} where id=${subscription.id}`;
  return true;
}

async function reconcileStaleRemediationAttempt(
  db: Sql,
  attempt: Record<string, unknown>,
) {
  let newSchedulePaused = false;
  if (attempt.issuedCardCiphertext && attempt.issuedCardIv && attempt.issuedCardTag) {
    try {
      const issuedCardId = decryptCardToken({
        ciphertext: attempt.issuedCardCiphertext as string,
        iv: attempt.issuedCardIv as string,
        tag: attempt.issuedCardTag as string,
      }, `remediation-attempt:${attempt.id as string}`);
      newSchedulePaused = await changeThePayOneCardStatus(
        issuedCardId,
        "중지",
        createPaymentTrackId("AUDT"),
      ).then(() => true).catch(() => false);
    } catch {
      newSchedulePaused = false;
    }
  }

  let oldScheduleRestored = attempt.status === "registering";
  if (attempt.status === "registered" && attempt.oldSchedulePaused === true) {
    try {
      const legacyCardId = decryptCardToken({
        ciphertext: attempt.legacyBillingKeyCiphertext as string,
        iv: attempt.legacyBillingKeyIv as string,
        tag: attempt.legacyBillingKeyTag as string,
      }, attempt.legacyPaymentMethodId as string);
      oldScheduleRestored = await changeThePayOneCardStatus(
        legacyCardId,
        "사용",
        createPaymentTrackId("AUDT"),
      ).then(() => true).catch(() => false);
    } catch {
      oldScheduleRestored = false;
    }
  }
  const safelyCompensated = newSchedulePaused && oldScheduleRestored;
  await db.begin(async (tx) => {
    if (attempt.newPaymentMethodId) await tx`
      update shorts_mvp.billing_payment_methods
      set status=${newSchedulePaused ? "paused" : "manual_review"},
        provider_schedule_status=${newSchedulePaused ? "paused" : "manual_review"}
      where id=${attempt.newPaymentMethodId as string}
    `;
    if (oldScheduleRestored) await tx`
      update shorts_mvp.billing_payment_methods
      set status='active',provider_schedule_status='active'
      where id=${attempt.legacyPaymentMethodId as string}
    `;
    await tx`
      update shorts_mvp.billing_payment_method_remediation_attempts
      set status=${safelyCompensated ? "compensated" : "manual_review"},
        new_schedule_compensated=${newSchedulePaused},
        failure_code='PROCESS_INTERRUPTED',failure_message='카드 등록 처리가 중단되었습니다.',
        issued_card_ciphertext=case when ${newSchedulePaused} then null else issued_card_ciphertext end,
        issued_card_iv=case when ${newSchedulePaused} then null else issued_card_iv end,
        issued_card_tag=case when ${newSchedulePaused} then null else issued_card_tag end,
        finished_at=now()
      where id=${attempt.id as string} and status in ('registering','registered')
    `;
    await tx`
      update shorts_mvp.billing_orders
      set status=${safelyCompensated ? "failed" : "manual_review"},
        failure_code='PROCESS_INTERRUPTED',failure_message='카드 등록 처리가 중단되었습니다.'
      where id=${attempt.billingOrderId as string}
        and status in ('processing','manual_review')
    `;
    await tx`
      update shorts_mvp.billing_payment_method_remediations
      set state=${safelyCompensated ? "required" : "manual_review"},claim_started_at=null,
        last_error_code='PROCESS_INTERRUPTED',last_error_message='카드 등록 처리가 중단되었습니다.'
      where id=${attempt.remediationId as string} and state='registering'
    `;
  });
  return safelyCompensated ? "compensated" : "manual_review";
}

export async function processBillingRenewals(db: Sql) {
  const expiredCardVerifications = await cleanupExpiredBillingCardVerifications(db);
  const expiredCheckouts = await db`
    update shorts_mvp.billing_orders set status='expired',failure_code='CHECKOUT_EXPIRED'
    where status='pending'
      and provider <> 'toss'
      and checkout_expires_at <= clock_timestamp()
    returning id
  `;
  const interrupted = await db`
    update shorts_mvp.billing_orders
    set status='manual_review',failure_code='PROCESS_INTERRUPTED'
    where status='processing'
      and provider <> 'toss'
      and kind in (
      'subscription_initial','subscription_renewal','subscription_change','annual_renewal','payment_method_update'
    ) and updated_at < clock_timestamp()-interval '2 minutes'
    returning id
  `;
  let staleRemediationAttempts = 0;
  if (await legacyCardReconciliationEnabled(db)) {
    const staleRows = await db`
      select a.*,r.legacy_payment_method_id,
        m.billing_key_ciphertext as legacy_billing_key_ciphertext,
        m.billing_key_iv as legacy_billing_key_iv,
        m.billing_key_tag as legacy_billing_key_tag
      from shorts_mvp.billing_payment_method_remediation_attempts a
      join shorts_mvp.billing_payment_method_remediations r on r.id=a.remediation_id
      join shorts_mvp.billing_payment_methods m on m.id=r.legacy_payment_method_id
      where a.status in ('registering','registered')
        and a.updated_at < clock_timestamp()-interval '2 minutes'
        and r.state='registering'
      order by a.updated_at
      limit 100
    `;
    for (const stale of staleRows) {
      await reconcileStaleRemediationAttempt(db, stale);
    }
    await db`
      update shorts_mvp.billing_payment_method_remediations
      set state='awaiting_provider'
      where enabled_at is not null and state='required'
        and (original_next_charge_at at time zone 'Asia/Seoul')::date
          <= (clock_timestamp() at time zone 'Asia/Seoul')::date
    `;
    staleRemediationAttempts = staleRows.length;
  }
  const expiredPackageRows = await db`
    update shorts_mvp.user_subscriptions
    set status='expired',ended_at=clock_timestamp(),next_charge_at=null,
      next_retry_at=null,next_quota_at=null,grace_ends_at=null
    where status='active'
      and plan_code in (
        'starter_3m','starter_6m','starter_12m',
        'expert_3m','expert_6m','expert_12m'
      )
      and current_period_end <= clock_timestamp()
    returning user_id
  `;
  const expiredPackageUserIds = [
    ...new Set(expiredPackageRows.map((row) => String(row.userId))),
  ];
  for (const userId of expiredPackageUserIds) {
    const activeRows = await db`
      select s.plan_code
      from shorts_mvp.user_subscriptions s
      join shorts_mvp.plans p on p.code=s.plan_code
      where s.user_id=${userId} and s.status='active'
        and s.current_period_start <= clock_timestamp()
        and s.current_period_end > clock_timestamp()
      order by p.max_active_jobs desc,p.retention_days desc,s.created_at desc
      limit 1
    `;
    await syncCachedPlan(db, userId, activeRows[0]?.planCode || "free");
  }
  const quotaRows = await db`
    select id from shorts_mvp.user_subscriptions
    where status='active'
      and coalesce(payment_provider,'thepayone') <> 'toss'
      and billing_cycle='yearly' and next_quota_at <= clock_timestamp()
      and current_period_end > next_quota_at
    order by next_quota_at limit 100
  `;
  let quotasCreated = 0;
  for (const row of quotaRows) if (await createDueAnnualQuota(db, row.id)) quotasCreated += 1;

  const dueRows = await db`
    select * from shorts_mvp.user_subscriptions
    where status='active'
      and coalesce(payment_provider,'thepayone') <> 'toss'
      and next_charge_at is not null
      and (
        (cancel_at_period_end and current_period_end <= clock_timestamp())
        or (scheduled_plan_code is not null and next_charge_at <= clock_timestamp())
        or (billing_cycle='yearly' and next_charge_at <= clock_timestamp())
        or (
          billing_cycle='monthly'
          and next_charge_at + ${webhookGraceHours()}*interval '1 hour' <= clock_timestamp()
        )
      )
    order by next_charge_at limit 100
  `;
  const results: Record<string, string> = {};
  for (const subscription of dueRows) {
    results[subscription.id] = await closeDueSubscription(db, subscription);
  }
  return {
    expiredCardVerifications,
    expiredCheckouts: expiredCheckouts.length,
    interruptedForManualReview: interrupted.length,
    staleRemediationAttempts,
    expiredPackages: expiredPackageRows.length,
    quotasCreated,
    processed: dueRows.length,
    results,
  };
}
