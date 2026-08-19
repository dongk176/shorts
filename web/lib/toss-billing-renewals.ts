import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { addKstMonths, createBillingOrderId, syncCachedPlan } from "@/lib/billing";
import { assertPersistedTossBillingCustomer } from "@/lib/billing-cohort";
import {
  tossBillingRenewalsEnabled,
  tossBillingSecretKey,
} from "@/lib/toss-billing-config";
import {
  executeRecordedTossCharge,
  reconcileUnknownTossPayment,
} from "@/lib/toss-billing-ledger";
import { loadTossChargeCredentials } from "@/lib/toss-billing-service";
import {
  isTossPlanCode,
  tossPlan,
  type TossCatalogPlan,
  type TossPlanCode,
} from "@/lib/toss-subscription";

type BillingDb = Sql | TransactionSql;

type TossRenewalSubscription = {
  id: string;
  userId: string;
  planCode: TossPlanCode;
  status: "active" | "past_due";
  paymentMethodId: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  nextChargeAt: Date | null;
  nextQuotaAt: Date | null;
  retryCount: number;
  nextRetryAt: Date | null;
  graceEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  billingAnchorDay: number;
  scheduledPlanCode: TossPlanCode | null;
};

type TossRenewalOrder = {
  id: string;
  userId: string;
  subscriptionId: string;
  paymentMethodId: string;
  productCode: TossPlanCode;
  amountKrw: number;
  orderId: string;
  orderName: string;
  status: string;
  renewalPeriodStart: Date;
};

type TossRenewalAttemptState = {
  attemptNo: number;
  nextRetryAt: Date | null;
  status: string;
};

export type TossRenewalDecision =
  | { action: "charge"; attemptNo: number }
  | { action: "reconcile" }
  | { action: "wait" }
  | { action: "exhausted" }
  | { action: "fulfill" };

export type TossRenewalItemResult = {
  subscriptionId: string;
  state: string;
};

export type TossBillingRenewalResult = {
  enabled: boolean;
  scanned: number;
  processed: number;
  quotasCreated: number;
  charged: number;
  renewed: number;
  canceled: number;
  expired: number;
  reconciliationPending: number;
  manualReview: number;
  results: TossRenewalItemResult[];
};

const MAX_RENEWAL_ATTEMPTS = 3;
const MAX_QUOTA_CATCH_UP_MONTHS = 12;
const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1_000;

export function decideTossRenewalAttempt(input: {
  orderStatus: string;
  attempts: TossRenewalAttemptState[];
  now: Date;
}): TossRenewalDecision {
  if (input.orderStatus === "succeeded") return { action: "fulfill" };
  if (input.attempts.some((attempt) => (
    attempt.status === "processing" || attempt.status === "unknown"
  ))) return { action: "reconcile" };
  const latest = input.attempts.reduce<TossRenewalAttemptState | null>(
    (selected, attempt) => !selected || attempt.attemptNo > selected.attemptNo
      ? attempt
      : selected,
    null,
  );
  if (!latest) return { action: "charge", attemptNo: 1 };
  if (latest.attemptNo >= MAX_RENEWAL_ATTEMPTS) return { action: "exhausted" };
  if (!latest.nextRetryAt || latest.nextRetryAt > input.now) return { action: "wait" };
  return { action: "charge", attemptNo: latest.attemptNo + 1 };
}

export function collectTossQuotaWindows(input: {
  nextQuotaAt: Date | null;
  contractEnd: Date;
  billingAnchorDay: number;
  now: Date;
  maxWindows?: number;
}) {
  const windows: Array<{ validFrom: Date; expiresAt: Date }> = [];
  const maxWindows = input.maxWindows ?? MAX_QUOTA_CATCH_UP_MONTHS;
  let cursor = input.nextQuotaAt;
  while (
    cursor
    && cursor <= input.now
    && cursor < input.contractEnd
    && windows.length < maxWindows
  ) {
    const next = addKstMonths(cursor, 1, input.billingAnchorDay);
    const expiresAt = next < input.contractEnd ? next : input.contractEnd;
    windows.push({ validFrom: cursor, expiresAt });
    cursor = expiresAt;
  }
  return { windows, nextQuotaAt: cursor };
}

function renewalProviderOrderId(orderId: string, attemptNo: number) {
  return attemptNo === 1 ? orderId : `${orderId}-R${attemptNo}`;
}

async function lockTossSubscription(db: BillingDb, subscriptionId: string) {
  const rows = await db`
    select id,user_id,plan_code,status,payment_method_id,current_period_start,
      current_period_end,next_charge_at,next_quota_at,retry_count,next_retry_at,
      grace_ends_at,cancel_at_period_end,billing_anchor_day,scheduled_plan_code
    from shorts_mvp.user_subscriptions
    where id=${subscriptionId} and payment_provider='toss'
      and status in ('active','past_due')
    for update
  `;
  const row = rows[0] as TossRenewalSubscription | undefined;
  if (!row || !isTossPlanCode(row.planCode)) return null;
  await db`select pg_advisory_xact_lock(hashtextextended(${`toss-billing:${row.userId}`},0))`;
  await assertPersistedTossBillingCustomer(row.userId, db);
  return row;
}

async function countActiveReservations(db: BillingDb, subscriptionId: string) {
  const rows = await db`
    select coalesce(sum(reserved_seconds),0)::integer as reserved_seconds
    from shorts_mvp.usage_grants
    where subscription_id=${subscriptionId} and status='active'
  `;
  return Number(rows[0]?.reservedSeconds ?? 0);
}

async function latestSucceededOrderId(db: BillingDb, subscriptionId: string) {
  const rows = await db`
    select id
    from shorts_mvp.billing_orders
    where subscription_id=${subscriptionId} and provider='toss' and status='succeeded'
    order by approved_at desc nulls last,created_at desc
    limit 1
  `;
  return rows[0]?.id as string | undefined;
}

async function insertTossBaseGrant(input: {
  db: BillingDb;
  subscription: TossRenewalSubscription;
  billingOrderId: string;
  plan: TossCatalogPlan;
  validFrom: Date;
  expiresAt: Date;
}) {
  await input.db`
    insert into shorts_mvp.usage_grants (
      user_id,subscription_id,billing_order_id,kind,product_code,total_seconds,
      credited_seconds,carried_seconds,valid_from,expires_at
    ) values (
      ${input.subscription.userId},${input.subscription.id},${input.billingOrderId},
      'base',${input.plan.code},${input.plan.monthlyQuotaSeconds},
      ${input.plan.monthlyQuotaSeconds},0,${input.validFrom},${input.expiresAt}
    )
    on conflict (subscription_id,valid_from,kind)
      where subscription_id is not null and kind='base'
    do nothing
  `;
}

async function issueDueQuotas(input: {
  db: Sql;
  subscriptionId: string;
  now: Date;
}) {
  return input.db.begin(async (tx) => {
    const subscription = await lockTossSubscription(tx, input.subscriptionId);
    if (!subscription || subscription.status !== "active") return 0;
    const schedule = collectTossQuotaWindows({
      nextQuotaAt: subscription.nextQuotaAt,
      contractEnd: subscription.currentPeriodEnd,
      billingAnchorDay: subscription.billingAnchorDay,
      now: input.now,
    });
    if (schedule.windows.length === 0) return 0;
    const billingOrderId = await latestSucceededOrderId(tx, subscription.id);
    if (!billingOrderId) {
      await markManualReview(tx, subscription, "정기 사용량의 원 결제 주문을 찾지 못했습니다.");
      return 0;
    }
    const plan = tossPlan(subscription.planCode);
    for (const window of schedule.windows) {
      await tx`
        update shorts_mvp.usage_grants
        set status='expired',updated_at=clock_timestamp()
        where subscription_id=${subscription.id} and kind='base' and status='active'
          and expires_at<=${window.validFrom} and reserved_seconds=0
      `;
      await insertTossBaseGrant({
        db: tx,
        subscription,
        billingOrderId,
        plan,
        ...window,
      });
    }
    await tx`
      update shorts_mvp.user_subscriptions
      set next_quota_at=${schedule.nextQuotaAt},updated_at=clock_timestamp()
      where id=${subscription.id} and payment_provider='toss'
    `;
    return schedule.windows.length;
  });
}

async function markManualReview(
  db: BillingDb,
  subscription: Pick<TossRenewalSubscription, "id" | "userId">,
  reason: string,
  billingOrderId?: string,
) {
  await db`
    update shorts_mvp.user_subscriptions
    set status='past_due',provider_schedule_status='manual_review',
      billing_review_status='manual_review',billing_review_reason=${reason.slice(0, 500)},
      next_retry_at=null,updated_at=clock_timestamp()
    where id=${subscription.id} and user_id=${subscription.userId}
      and payment_provider='toss'
  `;
  if (billingOrderId) {
    await db`
      update shorts_mvp.billing_orders
      set status='manual_review',failure_code='TOSS_FULFILLMENT_MANUAL_REVIEW',
        failure_message=${reason.slice(0, 300)},updated_at=clock_timestamp()
      where id=${billingOrderId} and provider='toss'
    `;
    await db`
      update shorts_mvp.billing_toss_transactions
      set fulfillment_status='manual_review',
        fulfillment_failure_message=${reason.slice(0, 500)},updated_at=clock_timestamp()
      where billing_order_id=${billingOrderId} and transaction_type='payment'
        and status='succeeded' and fulfillment_status='pending'
    `;
  }
  await syncCachedPlan(db, subscription.userId, "free");
}

async function cancelOrExpireTossSubscription(input: {
  db: Sql;
  subscriptionId: string;
  status: "canceled" | "expired";
  now: Date;
}) {
  return input.db.begin(async (tx) => {
    const subscription = await lockTossSubscription(tx, input.subscriptionId);
    if (!subscription) return false;
    await tx`
      update shorts_mvp.usage_grants
      set status=${input.status === "canceled" ? "revoked" : "expired"},
        updated_at=clock_timestamp()
      where subscription_id=${subscription.id} and kind='base' and status='active'
        and reserved_seconds=0
    `;
    await tx`
      update shorts_mvp.user_subscriptions
      set status=${input.status},ended_at=${input.now},next_charge_at=null,next_quota_at=null,
        scheduled_plan_code=null,scheduled_billing_cycle=null,
        scheduled_contract_months=null,scheduled_billing_price_krw=null,
        scheduled_change_effective_at=null,next_retry_at=null,grace_ends_at=null,
        provider_schedule_status='disposed',updated_at=clock_timestamp()
      where id=${subscription.id} and user_id=${subscription.userId}
        and payment_provider='toss'
    `;
    await syncCachedPlan(tx, subscription.userId, "free");
    return true;
  });
}

async function loadRenewalOrder(
  db: BillingDb,
  subscriptionId: string,
  renewalPeriodStart: Date,
) {
  const rows = await db`
    select id,user_id,subscription_id,payment_method_id,product_code,amount_krw,
      order_id,order_name,status,renewal_period_start
    from shorts_mvp.billing_orders
    where subscription_id=${subscriptionId} and kind='subscription_renewal'
      and renewal_period_start=${renewalPeriodStart} and provider='toss'
    limit 1
  `;
  const row = rows[0] as TossRenewalOrder | undefined;
  return row && isTossPlanCode(row.productCode) ? row : null;
}

async function ensureRenewalOrder(input: {
  db: BillingDb;
  subscription: TossRenewalSubscription;
  plan: TossCatalogPlan;
}) {
  const existing = await loadRenewalOrder(
    input.db,
    input.subscription.id,
    input.subscription.currentPeriodEnd,
  );
  if (existing) {
    if (
      existing.productCode !== input.plan.code
      || Number(existing.amountKrw) !== input.plan.priceKrw
      || existing.paymentMethodId !== input.subscription.paymentMethodId
    ) throw new Error("저장된 토스 갱신 주문이 현재 구독 조건과 일치하지 않습니다.");
    return existing;
  }
  const orderId = createBillingOrderId("REN");
  await input.db`
    insert into shorts_mvp.billing_orders (
      user_id,subscription_id,payment_method_id,request_id,kind,product_code,
      billing_cycle,amount_krw,order_id,order_name,status,provider,renewal_period_start
    ) values (
      ${input.subscription.userId},${input.subscription.id},${input.subscription.paymentMethodId},
      ${randomUUID()},'subscription_renewal',${input.plan.code},'yearly',
      ${input.plan.priceKrw},${orderId},
      ${`${input.plan.displayName} ${input.plan.contractMonths}개월 정기결제`},
      'pending','toss',${input.subscription.currentPeriodEnd}
    )
    on conflict (subscription_id,renewal_period_start)
      where kind='subscription_renewal' and renewal_period_start is not null
    do nothing
  `;
  const created = await loadRenewalOrder(
    input.db,
    input.subscription.id,
    input.subscription.currentPeriodEnd,
  );
  if (!created) throw new Error("토스 갱신 주문을 생성하지 못했습니다.");
  return created;
}

async function loadRenewalAttempts(db: BillingDb, billingOrderId: string) {
  const rows = await db`
    select attempt_no,next_retry_at,status
    from shorts_mvp.billing_toss_transactions
    where billing_order_id=${billingOrderId} and transaction_type='payment'
    order by attempt_no asc
  `;
  return rows as unknown as TossRenewalAttemptState[];
}

async function prepareRenewal(input: {
  db: Sql;
  subscriptionId: string;
  now: Date;
}) {
  return input.db.begin(async (tx) => {
    const subscription = await lockTossSubscription(tx, input.subscriptionId);
    if (!subscription) return { action: "gone" } as const;
    if (subscription.currentPeriodEnd > input.now) return { action: "not_due" } as const;
    if (subscription.cancelAtPeriodEnd) return { action: "cancel", subscription } as const;
    if (await countActiveReservations(tx, subscription.id) > 0) {
      return { action: "usage_in_progress" } as const;
    }
    if (subscription.status === "past_due" && subscription.graceEndsAt && subscription.graceEndsAt <= input.now) {
      return { action: "expire", subscription } as const;
    }
    const targetCode = subscription.scheduledPlanCode ?? subscription.planCode;
    if (!isTossPlanCode(targetCode)) throw new Error("갱신할 토스 요금제를 찾지 못했습니다.");
    const plan = tossPlan(targetCode);
    const order = await ensureRenewalOrder({ db: tx, subscription, plan });
    const attempts = await loadRenewalAttempts(tx, order.id);
    return {
      action: "renew" as const,
      subscription,
      plan,
      order,
      decision: decideTossRenewalAttempt({ orderStatus: order.status, attempts, now: input.now }),
    };
  });
}

async function reconcileRenewalAttempts(input: {
  db: Sql;
  subscriptionId: string;
  now: Date;
}) {
  const rows = await input.db`
    select transaction.id
    from shorts_mvp.billing_toss_transactions transaction
    join shorts_mvp.billing_orders billing_order on billing_order.id=transaction.billing_order_id
    where transaction.subscription_id=${input.subscriptionId}
      and transaction.transaction_type='payment'
      and transaction.status in ('processing','unknown')
      and billing_order.kind='subscription_renewal' and billing_order.provider='toss'
      and (
        (transaction.status='unknown' and coalesce(transaction.next_retry_at,transaction.updated_at)<=${input.now})
        or (transaction.status='processing' and transaction.updated_at<=${new Date(input.now.getTime() - 120_000)})
      )
    order by transaction.created_at asc
  `;
  for (const row of rows) {
    await reconcileUnknownTossPayment({ transactionId: row.id as string, db: input.db });
  }
  const unresolved = await input.db`
    select id
    from shorts_mvp.billing_toss_transactions
    where subscription_id=${input.subscriptionId} and transaction_type='payment'
      and status in ('processing','unknown')
    limit 1
  `;
  return unresolved.length > 0;
}

async function markRenewalFailure(input: {
  db: Sql;
  subscription: TossRenewalSubscription;
  providerOrderId: string;
  now: Date;
}) {
  const rows = await input.db`
    select status,failure_code,failure_message,next_retry_at,attempt_no
    from shorts_mvp.billing_toss_transactions
    where provider_order_id=${input.providerOrderId} and transaction_type='payment'
    limit 1
  `;
  const failure = rows[0] as {
    status: string;
    failureCode: string | null;
    failureMessage: string | null;
    nextRetryAt: Date | null;
    attemptNo: number;
  } | undefined;
  if (!failure) return;
  await input.db.begin(async (tx) => {
    const locked = await lockTossSubscription(tx, input.subscription.id);
    if (!locked) return;
    await tx`
      update shorts_mvp.user_subscriptions
      set status='past_due',retry_count=${Math.min(MAX_RENEWAL_ATTEMPTS, failure.attemptNo)},
        next_retry_at=${failure.nextRetryAt},
        grace_ends_at=coalesce(grace_ends_at,${new Date(input.now.getTime() + GRACE_PERIOD_MS)}),
        last_charge_failure_code=${failure.failureCode},
        last_charge_failure_message=${failure.failureMessage},
        provider_schedule_status=${failure.status === "unknown" ? "manual_review" : "paused"},
        updated_at=clock_timestamp()
      where id=${locked.id} and payment_provider='toss'
    `;
    await syncCachedPlan(tx, locked.userId, "free");
  });
}

async function fulfillRenewal(input: {
  db: Sql;
  subscriptionId: string;
  billingOrderId: string;
  now: Date;
}) {
  return input.db.begin(async (tx) => {
    const subscription = await lockTossSubscription(tx, input.subscriptionId);
    if (!subscription) return "gone" as const;
    const orderRows = await tx`
      select id,product_code,status,renewal_period_start,amount_krw
      from shorts_mvp.billing_orders
      where id=${input.billingOrderId} and subscription_id=${subscription.id}
        and kind='subscription_renewal' and provider='toss'
      for update
    `;
    const order = orderRows[0] as {
      id: string;
      productCode: string;
      status: string;
      renewalPeriodStart: Date;
      amountKrw: number;
    } | undefined;
    if (!order || order.status !== "succeeded" || !isTossPlanCode(order.productCode)) {
      throw new Error("승인된 토스 갱신 주문을 확인하지 못했습니다.");
    }
    const ledgerRows = await tx`
      select id,fulfillment_status
      from shorts_mvp.billing_toss_transactions
      where billing_order_id=${order.id} and transaction_type='payment' and status='succeeded'
      order by approved_at desc nulls last,created_at desc
      limit 1
      for update
    `;
    const ledger = ledgerRows[0] as { id: string; fulfillmentStatus: string } | undefined;
    if (!ledger) throw new Error("토스 갱신 결제 장부를 확인하지 못했습니다.");
    if (ledger.fulfillmentStatus === "applied") return "already_applied" as const;
    if (ledger.fulfillmentStatus === "manual_review") return "manual_review" as const;
    if (await countActiveReservations(tx, subscription.id) > 0) {
      await markManualReview(
        tx,
        subscription,
        "갱신 결제 승인 후 사용 중인 작업이 확인되어 자동 지급을 중단했습니다.",
        order.id,
      );
      return "manual_review" as const;
    }
    const plan = tossPlan(order.productCode);
    const periodStart = order.renewalPeriodStart;
    const periodEnd = addKstMonths(periodStart, plan.contractMonths, subscription.billingAnchorDay);
    const firstQuotaEnd = addKstMonths(periodStart, 1, subscription.billingAnchorDay);
    const nextQuotaAt = firstQuotaEnd < periodEnd ? firstQuotaEnd : periodEnd;
    await tx`
      update shorts_mvp.usage_grants
      set status='expired',updated_at=clock_timestamp()
      where subscription_id=${subscription.id} and kind='base' and status='active'
        and reserved_seconds=0
    `;
    await insertTossBaseGrant({
      db: tx,
      subscription,
      billingOrderId: order.id,
      plan,
      validFrom: periodStart,
      expiresAt: nextQuotaAt,
    });
    await tx`
      update shorts_mvp.user_subscriptions
      set plan_code=${plan.code},status='active',billing_cycle='monthly',
        current_period_start=${periodStart},current_period_end=${periodEnd},
        next_charge_at=${periodEnd},next_quota_at=${nextQuotaAt},
        contract_months=${plan.contractMonths},billing_price_krw=${plan.priceKrw},
        scheduled_plan_code=null,scheduled_billing_cycle=null,
        scheduled_contract_months=null,scheduled_billing_price_krw=null,
        scheduled_change_effective_at=null,cancel_at_period_end=false,canceled_at=null,
        retry_count=0,next_retry_at=null,grace_ends_at=null,
        last_charge_at=${input.now},last_charge_failure_code=null,
        last_charge_failure_message=null,provider_schedule_status='active',
        billing_review_status='clear',billing_review_reason=null,
        last_provider_event_at=${input.now},updated_at=clock_timestamp()
      where id=${subscription.id} and user_id=${subscription.userId}
        and payment_provider='toss'
    `;
    await tx`
      update shorts_mvp.billing_toss_transactions
      set fulfillment_status='applied',fulfillment_failure_message=null,
        fulfilled_at=clock_timestamp(),updated_at=clock_timestamp()
      where billing_order_id=${order.id} and transaction_type='payment'
        and status='succeeded' and fulfillment_status='pending'
    `;
    await syncCachedPlan(tx, subscription.userId, plan.tier === "easycut_pro"
      ? "easycut_pro_v2"
      : plan.tier === "starter" ? "starter_6m" : "expert_6m");
    return "applied" as const;
  });
}

async function candidateSubscriptionIds(db: Sql, now: Date) {
  const rows = await db`
    select distinct subscription.id
    from shorts_mvp.user_subscriptions subscription
    join shorts_mvp.billing_customer_cohorts cohort
      on cohort.user_id=subscription.user_id and cohort.cohort='toss_v1'
    where subscription.payment_provider='toss'
      and subscription.status in ('active','past_due')
      and (
        subscription.current_period_end<=${now}
        or (subscription.status='active' and subscription.next_quota_at<=${now})
        or (subscription.status='past_due' and subscription.next_retry_at<=${now})
        or (subscription.status='past_due' and subscription.grace_ends_at<=${now})
        or exists (
          select 1 from shorts_mvp.billing_toss_transactions transaction
          where transaction.subscription_id=subscription.id
            and transaction.transaction_type='payment'
            and transaction.status in ('processing','unknown')
            and coalesce(transaction.next_retry_at,transaction.updated_at)<=${now}
        )
      )
    order by subscription.id
    limit 100
  `;
  return rows.map((row) => row.id as string);
}

async function processOneTossRenewal(input: {
  db: Sql;
  subscriptionId: string;
  now: Date;
}) {
  const unresolved = await reconcileRenewalAttempts(input);
  if (unresolved) return { state: "reconciliation_pending", quotasCreated: 0, charged: 0 };
  const quotasCreated = await issueDueQuotas(input);
  const prepared = await prepareRenewal(input);
  if (prepared.action === "gone" || prepared.action === "not_due") {
    return { state: quotasCreated ? "quota_created" : prepared.action, quotasCreated, charged: 0 };
  }
  if (prepared.action === "usage_in_progress") {
    return { state: "usage_in_progress", quotasCreated, charged: 0 };
  }
  if (prepared.action === "cancel" || prepared.action === "expire") {
    await cancelOrExpireTossSubscription({
      db: input.db,
      subscriptionId: input.subscriptionId,
      status: prepared.action === "cancel" ? "canceled" : "expired",
      now: input.now,
    });
    return { state: prepared.action === "cancel" ? "canceled" : "expired", quotasCreated, charged: 0 };
  }
  if (prepared.decision.action === "fulfill") {
    const state = await fulfillRenewal({
      db: input.db,
      subscriptionId: input.subscriptionId,
      billingOrderId: prepared.order.id,
      now: input.now,
    });
    return { state: state === "applied" ? "renewed" : state, quotasCreated, charged: 0 };
  }
  if (prepared.decision.action === "reconcile") {
    return { state: "reconciliation_pending", quotasCreated, charged: 0 };
  }
  if (prepared.decision.action === "wait" || prepared.decision.action === "exhausted") {
    return { state: prepared.decision.action, quotasCreated, charged: 0 };
  }

  const providerOrderId = renewalProviderOrderId(
    prepared.order.orderId,
    prepared.decision.attemptNo,
  );
  const idempotencyKey = `toss-renewal:${prepared.order.id}:${prepared.decision.attemptNo}`;
  try {
    const credentials = await loadTossChargeCredentials({
      db: input.db,
      userId: prepared.subscription.userId,
      paymentMethodId: prepared.subscription.paymentMethodId,
    });
    const charged = await executeRecordedTossCharge({
      db: input.db,
      userId: prepared.subscription.userId,
      billingOrderId: prepared.order.id,
      subscriptionId: prepared.subscription.id,
      paymentMethodId: prepared.subscription.paymentMethodId,
      providerOrderId,
      idempotencyKey,
      attemptNo: prepared.decision.attemptNo,
      ...credentials,
      amountKrw: prepared.plan.priceKrw,
      orderName: prepared.order.orderName,
    });
    if (charged.state === "reconciliation_required") {
      return { state: "reconciliation_pending", quotasCreated, charged: 0 };
    }
    if (charged.state === "failed") {
      await markRenewalFailure({
        db: input.db,
        subscription: prepared.subscription,
        providerOrderId,
        now: input.now,
      });
      return { state: "failed", quotasCreated, charged: 0 };
    }
    const fulfilled = await fulfillRenewal({
      db: input.db,
      subscriptionId: prepared.subscription.id,
      billingOrderId: prepared.order.id,
      now: input.now,
    });
    return {
      state: fulfilled === "applied" ? "renewed" : fulfilled,
      quotasCreated,
      charged: charged.state === "succeeded" ? 1 : 0,
    };
  } catch {
    await markRenewalFailure({
      db: input.db,
      subscription: prepared.subscription,
      providerOrderId,
      now: input.now,
    });
    return { state: "failed", quotasCreated, charged: 0 };
  }
}

export async function processTossBillingRenewals(
  db: Sql,
  options: { now?: Date } = {},
): Promise<TossBillingRenewalResult> {
  if (!tossBillingRenewalsEnabled()) {
    return {
      enabled: false,
      scanned: 0,
      processed: 0,
      quotasCreated: 0,
      charged: 0,
      renewed: 0,
      canceled: 0,
      expired: 0,
      reconciliationPending: 0,
      manualReview: 0,
      results: [],
    };
  }
  // Validate the server-only secret before creating any ledger attempt.
  tossBillingSecretKey();
  const now = options.now ?? new Date();
  const ids = await candidateSubscriptionIds(db, now);
  const results: TossRenewalItemResult[] = [];
  let quotasCreated = 0;
  let charged = 0;
  for (const subscriptionId of ids) {
    try {
      const result = await processOneTossRenewal({ db, subscriptionId, now });
      quotasCreated += result.quotasCreated;
      charged += result.charged;
      results.push({ subscriptionId, state: result.state });
    } catch (error) {
      console.error("toss_billing_renewal_item_failed", {
        subscriptionId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      results.push({ subscriptionId, state: "error" });
    }
  }
  return {
    enabled: true,
    scanned: ids.length,
    processed: results.length,
    quotasCreated,
    charged,
    renewed: results.filter((item) => item.state === "renewed").length,
    canceled: results.filter((item) => item.state === "canceled").length,
    expired: results.filter((item) => item.state === "expired").length,
    reconciliationPending: results.filter((item) => item.state === "reconciliation_pending").length,
    manualReview: results.filter((item) => item.state === "manual_review").length,
    results,
  };
}
