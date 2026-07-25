import type { Sql } from "postgres";
import { cleanupExpiredBillingCardVerifications } from "@/lib/billing-card-verifications";
import {
  createBaseUsageGrant,
  getPaidPlan,
  syncCachedPlan,
} from "@/lib/billing";
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

async function closeDueSubscription(db: Sql, subscription: Record<string, unknown>) {
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

export async function processBillingRenewals(db: Sql) {
  const expiredCardVerifications = await cleanupExpiredBillingCardVerifications(db);
  const expiredCheckouts = await db`
    update shorts_mvp.billing_orders set status='expired',failure_code='CHECKOUT_EXPIRED'
    where status='pending' and checkout_expires_at <= clock_timestamp() returning id
  `;
  const interrupted = await db`
    update shorts_mvp.billing_orders
    set status='manual_review',failure_code='PROCESS_INTERRUPTED'
    where status='processing' and kind in (
      'subscription_initial','subscription_renewal','subscription_change','annual_renewal','payment_method_update'
    ) and updated_at < clock_timestamp()-interval '2 minutes'
    returning id
  `;
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
    where status='active' and billing_cycle='yearly' and next_quota_at <= clock_timestamp()
      and current_period_end > next_quota_at
    order by next_quota_at limit 100
  `;
  let quotasCreated = 0;
  for (const row of quotaRows) if (await createDueAnnualQuota(db, row.id)) quotasCreated += 1;

  const dueRows = await db`
    select * from shorts_mvp.user_subscriptions
    where status='active' and next_charge_at is not null
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
    expiredPackages: expiredPackageRows.length,
    quotasCreated,
    processed: dueRows.length,
    results,
  };
}
