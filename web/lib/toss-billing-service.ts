import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { addKstMonths, createBillingOrderId, syncCachedPlan } from "@/lib/billing";
import { assertPersistedTossBillingCustomer } from "@/lib/billing-cohort";
import type { PlanCode } from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import {
  deleteTossBillingKey,
  issueTossBillingKey,
} from "@/lib/toss-billing-api";
import {
  decryptTossBillingKey,
  encryptTossBillingKey,
  tossBillingKeyContext,
  tossBillingKeyHash,
} from "@/lib/toss-billing-crypto";
import {
  executeRecordedTossCharge,
  type TossRecordedChargeResult,
} from "@/lib/toss-billing-ledger";
import {
  classifyTossSubscriptionChange,
  quoteImmediateTossChange,
  tossPlan,
  type TossCatalogPlan,
  type TossPlanCode,
} from "@/lib/toss-subscription";

type BillingDb = Sql | TransactionSql;

type TossPaymentMethodRow = {
  id: string;
  userId: string;
  providerCustomerKey: string;
  billingKeyCiphertext: string;
  billingKeyIv: string;
  billingKeyTag: string;
  issuerCode: string | null;
  cardNumberMasked: string | null;
  cardLast4: string | null;
  status: string;
};

type TossSubscriptionRow = {
  id: string;
  userId: string;
  planCode: TossPlanCode;
  status: string;
  paymentMethodId: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  contractMonths: number;
  billingPriceKrw: number;
};

type PreparedTossCharge = {
  billingOrderId: string;
  subscriptionId: string;
  paymentMethodId: string;
  providerOrderId: string;
  requestId: string;
  amountKrw: number;
  orderName: string;
  targetPlanCode: TossPlanCode;
};

type FailedInitialAttemptState = {
  subscriptionStatus: string;
  orderKind: string | null;
  orderStatus: string | null;
  ledgerStatuses: string[];
  fulfillmentStatuses: string[];
};

export type TossSubscriptionMutationResult =
  | { state: "succeeded"; subscriptionId: string; planCode: TossPlanCode; remainingSeconds: number }
  | { state: "scheduled"; subscriptionId: string; planCode: TossPlanCode; effectiveAt: Date }
  | { state: "unchanged"; subscriptionId: string; planCode: TossPlanCode }
  | { state: "reconciliation_required"; subscriptionId: string; planCode: TossPlanCode }
  | { state: "failed"; subscriptionId: string; planCode: TossPlanCode };

export function cachedPlanCodeForTossTier(tier: TossCatalogPlan["tier"]): PlanCode {
  if (tier === "easycut_pro") return "easycut_pro_v2";
  if (tier === "starter") return "starter_6m";
  return "expert_6m";
}

export function kstBillingAnchorDay(date: Date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1_000).getUTCDate();
}

export function tossMonthlyGrantWindow(input: {
  grantedAt: Date;
  contractEnd: Date;
  billingAnchorDay: number;
}) {
  const nextMonth = addKstMonths(input.grantedAt, 1, input.billingAnchorDay);
  return {
    expiresAt: nextMonth < input.contractEnd ? nextMonth : input.contractEnd,
    nextQuotaAt: nextMonth < input.contractEnd ? nextMonth : input.contractEnd,
  };
}

export function cardLast4FromMaskedNumber(maskedNumber: string | null | undefined) {
  const match = maskedNumber?.match(/(\d{4})$/);
  return match?.[1] ?? null;
}

export function canRetireFailedTossInitialAttempt(input: FailedInitialAttemptState) {
  return input.subscriptionStatus === "pending"
    && input.orderKind === "subscription_initial"
    && input.orderStatus === "failed"
    && input.ledgerStatuses.length > 0
    && input.ledgerStatuses.every((status) => status === "failed")
    && input.fulfillmentStatuses.every((status) => status === "pending");
}

function boundedNullableText(value: string | null | undefined, max: number) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export function safeTossMaskedCardNumber(value: string | null | undefined) {
  const masked = boundedNullableText(value, 32);
  if (!masked || !masked.includes("*") || !/^[0-9* -]+$/.test(masked)) return null;
  return masked;
}

function safeProviderTimestamp(value: string | null | undefined) {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function lockTossCustomer(db: BillingDb, userId: string) {
  await db`select pg_advisory_xact_lock(hashtextextended(${`toss-billing:${userId}`},0))`;
  return assertPersistedTossBillingCustomer(userId, db);
}

async function assertStoredTossPlan(db: BillingDb, plan: TossCatalogPlan) {
  const rows = await db`
    select code,monthly_source_seconds,monthly_price_krw,yearly_price_krw,
      max_active_jobs,prepaid_months,is_active
    from shorts_mvp.plans
    where code=${plan.code}
    limit 1
  `;
  const row = rows[0] as {
    code: string;
    monthlySourceSeconds: number;
    monthlyPriceKrw: number;
    yearlyPriceKrw: number;
    maxActiveJobs: number;
    prepaidMonths: number;
    isActive: boolean;
  } | undefined;
  if (
    !row
    || row.code !== plan.code
    || Number(row.monthlySourceSeconds) !== plan.monthlyQuotaSeconds
    || Number(row.monthlyPriceKrw) !== plan.monthlyEquivalentKrw
    || Number(row.yearlyPriceKrw) !== plan.priceKrw
    || Number(row.maxActiveJobs) !== plan.maxActiveJobs
    || Number(row.prepaidMonths) !== plan.contractMonths
    || row.isActive !== false
  ) {
    throw new HttpError(
      503,
      "토스 요금제 구성을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.",
      "TOSS_PLAN_CATALOG_MISMATCH",
    );
  }
}

async function loadTossPaymentMethod(
  db: BillingDb,
  userId: string,
  paymentMethodId: string,
  lock = false,
) {
  const rows = lock
    ? await db`
        select id,user_id,provider_customer_key,billing_key_ciphertext,
          billing_key_iv,billing_key_tag,issuer_code,card_number_masked,card_last4,status
        from shorts_mvp.billing_payment_methods
        where id=${paymentMethodId} and user_id=${userId} and provider='toss'
        for update
      `
    : await db`
        select id,user_id,provider_customer_key,billing_key_ciphertext,
          billing_key_iv,billing_key_tag,issuer_code,card_number_masked,card_last4,status
        from shorts_mvp.billing_payment_methods
        where id=${paymentMethodId} and user_id=${userId} and provider='toss'
        limit 1
      `;
  const row = rows[0] as TossPaymentMethodRow | undefined;
  if (!row || row.status !== "active" || !row.providerCustomerKey) {
    throw new HttpError(409, "등록된 토스 결제카드를 확인해 주세요.", "TOSS_PAYMENT_METHOD_UNAVAILABLE");
  }
  return row;
}

function decryptPaymentMethodBillingKey(row: TossPaymentMethodRow) {
  return decryptTossBillingKey(
    {
      ciphertext: row.billingKeyCiphertext,
      iv: row.billingKeyIv,
      tag: row.billingKeyTag,
    },
    tossBillingKeyContext(row.userId, row.id),
  );
}

export async function loadTossChargeCredentials(input: {
  db?: Sql;
  userId: string;
  paymentMethodId: string;
}) {
  const db = input.db ?? getDb();
  const paymentMethod = await loadTossPaymentMethod(
    db,
    input.userId,
    input.paymentMethodId,
  );
  return {
    billingKey: decryptPaymentMethodBillingKey(paymentMethod),
    customerKey: paymentMethod.providerCustomerKey,
  };
}

export async function registerTossBillingKey(input: {
  userId: string;
  authKey: string;
  paymentMethodId?: string;
  db?: Sql;
  issue?: typeof issueTossBillingKey;
  removeIssuedKey?: typeof deleteTossBillingKey;
}) {
  const db = input.db ?? getDb();
  const cohort = await assertPersistedTossBillingCustomer(input.userId, db);
  const paymentMethodId = input.paymentMethodId ?? randomUUID();
  const existingRows = await db`
    select id,user_id,provider_customer_key,billing_key_ciphertext,
      billing_key_iv,billing_key_tag,issuer_code,card_number_masked,card_last4,status
    from shorts_mvp.billing_payment_methods
    where id=${paymentMethodId}
    limit 1
  `;
  const existing = existingRows[0] as TossPaymentMethodRow | undefined;
  if (existing) {
    if (
      existing.userId !== input.userId
      || existing.providerCustomerKey !== cohort.providerCustomerKey
      || existing.status !== "active"
    ) {
      throw new HttpError(409, "카드등록 요청이 다른 결제정보와 충돌했습니다.", "TOSS_PAYMENT_METHOD_ID_CONFLICT");
    }
    return {
      id: existing.id,
      issuerCode: existing.issuerCode,
      cardNumberMasked: existing.cardNumberMasked,
      cardLast4: existing.cardLast4,
    };
  }
  const issued = await (input.issue ?? issueTossBillingKey)({
    authKey: input.authKey,
    customerKey: cohort.providerCustomerKey,
  });
  if (issued.customerKey !== cohort.providerCustomerKey) {
    throw new HttpError(409, "카드등록 고객 정보를 확인하지 못했습니다.", "TOSS_CUSTOMER_KEY_MISMATCH");
  }

  const encrypted = encryptTossBillingKey(
    issued.billingKey,
    tossBillingKeyContext(input.userId, paymentMethodId),
  );
  // Never persist a raw PAN even if the provider response unexpectedly changes.
  const maskedNumber = safeTossMaskedCardNumber(issued.card?.number);
  try {
    await db.begin(async (tx) => {
      const lockedCohort = await lockTossCustomer(tx, input.userId);
      if (lockedCohort.providerCustomerKey !== issued.customerKey) {
        throw new Error("저장된 토스 고객 식별자가 일치하지 않습니다.");
      }
      await tx`
        update shorts_mvp.billing_payment_methods
        set status='replaced',updated_at=clock_timestamp()
        where user_id=${input.userId} and provider='toss' and status='active'
          and id<>${paymentMethodId}
      `;
      await tx`
        insert into shorts_mvp.billing_payment_methods (
          id,user_id,billing_key_ciphertext,billing_key_iv,billing_key_tag,billing_key_hash,
          issuer_code,card_number_masked,card_last4,card_type,status,provider,
          provider_customer_key,provider_billing_key_issued_at,registration_result_code
        ) values (
          ${paymentMethodId},${input.userId},${encrypted.ciphertext},${encrypted.iv},${encrypted.tag},
          ${tossBillingKeyHash(issued.billingKey)},${boundedNullableText(issued.card?.issuerCode, 30)},
          ${maskedNumber},${cardLast4FromMaskedNumber(maskedNumber)},
          ${boundedNullableText(issued.card?.cardType, 30)},'active','toss',
          ${issued.customerKey},${safeProviderTimestamp(issued.authenticatedAt)},'SUCCESS'
        )
      `;
    });
  } catch (error) {
    try {
      await (input.removeIssuedKey ?? deleteTossBillingKey)(issued.billingKey);
    } catch {
      // The issued key is never logged. Reconciliation can delete it from the
      // provider console if storage failed and provider deletion is uncertain.
    }
    throw error;
  }
  return {
    id: paymentMethodId,
    issuerCode: issued.card?.issuerCode ?? null,
    cardNumberMasked: maskedNumber,
    cardLast4: cardLast4FromMaskedNumber(maskedNumber),
  };
}

async function loadCurrentTossSubscription(
  db: BillingDb,
  userId: string,
  lock = false,
) {
  const rows = lock
    ? await db`
        select id,user_id,plan_code,status,payment_method_id,current_period_start,
          current_period_end,contract_months,billing_price_krw
        from shorts_mvp.user_subscriptions
        where user_id=${userId} and payment_provider='toss'
          and status in ('pending','trialing','active','past_due')
        order by created_at desc
        limit 1
        for update
      `
    : await db`
        select id,user_id,plan_code,status,payment_method_id,current_period_start,
          current_period_end,contract_months,billing_price_krw
        from shorts_mvp.user_subscriptions
        where user_id=${userId} and payment_provider='toss'
          and status in ('pending','trialing','active','past_due')
        order by created_at desc
        limit 1
      `;
  return rows[0] as TossSubscriptionRow | undefined;
}

async function createPendingTossOrder(input: {
  db: TransactionSql;
  userId: string;
  subscriptionId: string;
  paymentMethodId: string;
  requestId: string;
  kind: "subscription_initial" | "subscription_change";
  plan: TossCatalogPlan;
  amountKrw: number;
  orderName: string;
}) {
  const existing = await input.db`
    select id,subscription_id,payment_method_id,product_code,amount_krw,order_id,order_name,status
    from shorts_mvp.billing_orders
    where request_id=${input.requestId}
    limit 1
    for update
  `;
  if (existing[0]) {
    const row = existing[0] as {
      id: string;
      subscriptionId: string;
      paymentMethodId: string;
      productCode: string;
      amountKrw: number;
      orderId: string;
      orderName: string;
      status: string;
    };
    if (
      row.subscriptionId !== input.subscriptionId
      || row.paymentMethodId !== input.paymentMethodId
      || row.productCode !== input.plan.code
      || Number(row.amountKrw) !== input.amountKrw
    ) throw new HttpError(409, "같은 요청번호가 다른 결제와 충돌했습니다.", "TOSS_REQUEST_ID_CONFLICT");
    return {
      billingOrderId: row.id,
      providerOrderId: row.orderId,
      orderName: row.orderName,
      status: row.status,
    };
  }

  const providerOrderId = createBillingOrderId("SUB");
  const inserted = await input.db`
    insert into shorts_mvp.billing_orders (
      user_id,subscription_id,payment_method_id,request_id,kind,product_code,
      billing_cycle,amount_krw,order_id,order_name,status,provider
    ) values (
      ${input.userId},${input.subscriptionId},${input.paymentMethodId},${input.requestId},
      ${input.kind},${input.plan.code},'monthly',${input.amountKrw},${providerOrderId},
      ${input.orderName},'pending','toss'
    )
    returning id,order_id,order_name,status
  `;
  const row = inserted[0] as { id: string; orderId: string; orderName: string; status: string };
  return {
    billingOrderId: row.id,
    providerOrderId: row.orderId,
    orderName: row.orderName,
    status: row.status,
  };
}

async function prepareInitialPurchase(input: {
  db: Sql;
  userId: string;
  paymentMethodId: string;
  requestId: string;
  targetPlanCode: TossPlanCode;
}) {
  const plan = tossPlan(input.targetPlanCode);
  return input.db.begin(async (tx): Promise<PreparedTossCharge> => {
    await lockTossCustomer(tx, input.userId);
    await assertStoredTossPlan(tx, plan);
    await loadTossPaymentMethod(tx, input.userId, input.paymentMethodId, true);

    const retryRows = await tx`
      select o.id,o.user_id,o.subscription_id,o.payment_method_id,o.product_code,
        o.amount_krw,o.order_id,o.order_name,o.provider,s.payment_provider
      from shorts_mvp.billing_orders o
      left join shorts_mvp.user_subscriptions s on s.id=o.subscription_id
      where o.request_id=${input.requestId}
      limit 1
      for update of o
    `;
    if (retryRows[0]) {
      const retry = retryRows[0] as {
        id: string;
        userId: string;
        subscriptionId: string | null;
        paymentMethodId: string | null;
        productCode: string;
        amountKrw: number;
        orderId: string;
        orderName: string;
        provider: string;
        paymentProvider: string | null;
      };
      if (
        retry.userId !== input.userId
        || retry.provider !== "toss"
        || retry.paymentProvider !== "toss"
        || !retry.subscriptionId
        || retry.paymentMethodId !== input.paymentMethodId
        || retry.productCode !== plan.code
        || Number(retry.amountKrw) !== plan.priceKrw
      ) {
        throw new HttpError(409, "같은 요청번호가 다른 결제와 충돌했습니다.", "TOSS_REQUEST_ID_CONFLICT");
      }
      return {
        billingOrderId: retry.id,
        subscriptionId: retry.subscriptionId,
        paymentMethodId: input.paymentMethodId,
        providerOrderId: retry.orderId,
        requestId: input.requestId,
        amountKrw: plan.priceKrw,
        orderName: retry.orderName,
        targetPlanCode: plan.code,
      };
    }

    let current = await loadCurrentTossSubscription(tx, input.userId, true);
    if (current?.status === "pending") {
      const attemptRows = await tx`
        select o.kind,o.status,
          coalesce(array_agg(t.status order by t.created_at)
            filter (where t.id is not null),array[]::text[]) as ledger_statuses,
          coalesce(array_agg(t.fulfillment_status order by t.created_at)
            filter (where t.id is not null),array[]::text[]) as fulfillment_statuses
        from shorts_mvp.billing_orders o
        left join shorts_mvp.billing_toss_transactions t
          on t.billing_order_id=o.id and t.transaction_type='payment'
        where o.subscription_id=${current.id} and o.provider='toss'
        group by o.id,o.kind,o.status,o.created_at
        order by o.created_at desc
        limit 1
      `;
      const attempt = attemptRows[0] as {
        kind: string | null;
        status: string | null;
        ledgerStatuses: string[];
        fulfillmentStatuses: string[];
      } | undefined;
      if (attempt && canRetireFailedTossInitialAttempt({
        subscriptionStatus: current.status,
        orderKind: attempt.kind,
        orderStatus: attempt.status,
        ledgerStatuses: attempt.ledgerStatuses,
        fulfillmentStatuses: attempt.fulfillmentStatuses,
      })) {
        await tx`
          update shorts_mvp.user_subscriptions
          set status='expired',ended_at=clock_timestamp(),next_charge_at=null,
            next_retry_at=null,next_quota_at=null,grace_ends_at=null,retry_count=0,
            provider_schedule_status='disposed',updated_at=clock_timestamp()
          where id=${current.id} and user_id=${input.userId}
            and payment_provider='toss' and status='pending'
        `;
        current = undefined;
      }
    }
    if (current) {
      throw new HttpError(409, "이미 이용 중인 토스 구독이 있습니다.", "TOSS_SUBSCRIPTION_ALREADY_EXISTS");
    }
    const now = new Date();
    const subscriptionEnd = addKstMonths(now, plan.contractMonths, kstBillingAnchorDay(now));
    const subscriptions = await tx`
      insert into shorts_mvp.user_subscriptions (
        user_id,plan_code,status,current_period_start,current_period_end,billing_cycle,
        payment_method_id,billing_anchor_day,payment_provider,provider_schedule_status,
        contract_months,billing_price_krw
      ) values (
        ${input.userId},${plan.code},'pending',${now},${subscriptionEnd},'monthly',
        ${input.paymentMethodId},${kstBillingAnchorDay(now)},'toss','active',
        ${plan.contractMonths},${plan.priceKrw}
      )
      returning id
    `;
    const subscriptionId = String(subscriptions[0].id);
    const orderName = `${plan.displayName} ${plan.contractMonths}개월`;
    const order = await createPendingTossOrder({
      db: tx,
      userId: input.userId,
      subscriptionId,
      paymentMethodId: input.paymentMethodId,
      requestId: input.requestId,
      kind: "subscription_initial",
      plan,
      amountKrw: plan.priceKrw,
      orderName,
    });
    return {
      billingOrderId: order.billingOrderId,
      subscriptionId,
      paymentMethodId: input.paymentMethodId,
      providerOrderId: order.providerOrderId,
      requestId: input.requestId,
      amountKrw: plan.priceKrw,
      orderName,
      targetPlanCode: plan.code,
    };
  });
}

async function markFulfillmentManualReview(db: Sql, billingOrderId: string, message: string) {
  await db`
    update shorts_mvp.billing_toss_transactions
    set fulfillment_status='manual_review',fulfillment_failure_message=${message.slice(0, 300)},
      updated_at=clock_timestamp()
    where billing_order_id=${billingOrderId} and transaction_type='payment'
      and status='succeeded' and fulfillment_status='pending'
  `;
}

async function applyTossEntitlement(input: {
  db: Sql;
  userId: string;
  prepared: PreparedTossCharge;
  replaceExistingGrant: boolean;
}) {
  const plan = tossPlan(input.prepared.targetPlanCode);
  try {
    return await input.db.begin(async (tx) => {
      await lockTossCustomer(tx, input.userId);
      await assertStoredTossPlan(tx, plan);
      const ledgerRows = await tx`
        select id,status,fulfillment_status
        from shorts_mvp.billing_toss_transactions
        where billing_order_id=${input.prepared.billingOrderId} and transaction_type='payment'
        limit 1
        for update
      `;
      const ledger = ledgerRows[0] as {
        id: string;
        status: string;
        fulfillmentStatus: string;
      } | undefined;
      if (!ledger || ledger.status !== "succeeded") {
        throw new Error("승인된 토스 결제 장부를 찾지 못했습니다.");
      }
      if (ledger.fulfillmentStatus === "applied") {
        const activeGrant = await tx`
          select greatest(total_seconds-reserved_seconds-consumed_seconds,0) as remaining_seconds
          from shorts_mvp.usage_grants
          where subscription_id=${input.prepared.subscriptionId} and kind='base' and status='active'
          order by valid_from desc limit 1
        `;
        return Number(activeGrant[0]?.remainingSeconds ?? 0);
      }
      if (ledger.fulfillmentStatus !== "pending") {
        throw new Error("토스 결제 후 사용량 반영 상태를 직접 확인해야 합니다.");
      }

      const subscriptionRows = await tx`
        select id,user_id,payment_provider,status
        from shorts_mvp.user_subscriptions
        where id=${input.prepared.subscriptionId}
        for update
      `;
      const subscription = subscriptionRows[0] as {
        id: string;
        userId: string;
        paymentProvider: string | null;
        status: string;
      } | undefined;
      if (
        !subscription
        || subscription.userId !== input.userId
        || subscription.paymentProvider !== "toss"
      ) throw new Error("토스 구독 소유권을 확인하지 못했습니다.");

      if (input.replaceExistingGrant) {
        const reserved = await tx`
          select coalesce(sum(reserved_seconds),0)::integer as reserved_seconds
          from shorts_mvp.usage_grants
          where subscription_id=${subscription.id} and kind='base' and status='active'
        `;
        if (Number(reserved[0]?.reservedSeconds ?? 0) > 0) {
          throw new HttpError(
            409,
            "처리 중인 영상이 끝난 뒤 요금제를 전환해 주세요.",
            "TOSS_USAGE_RESERVATION_ACTIVE",
          );
        }
        await tx`
          update shorts_mvp.usage_grants
          set status='revoked',updated_at=clock_timestamp()
          where subscription_id=${subscription.id} and kind='base' and status='active'
        `;
      }

      const startedAt = new Date();
      const anchorDay = kstBillingAnchorDay(startedAt);
      const contractEnd = addKstMonths(startedAt, plan.contractMonths, anchorDay);
      const quotaWindow = tossMonthlyGrantWindow({
        grantedAt: startedAt,
        contractEnd,
        billingAnchorDay: anchorDay,
      });
      await tx`
        update shorts_mvp.user_subscriptions
        set plan_code=${plan.code},status='active',current_period_start=${startedAt},
          current_period_end=${contractEnd},billing_cycle='monthly',
          payment_method_id=${input.prepared.paymentMethodId},next_charge_at=${contractEnd},
          next_quota_at=${quotaWindow.nextQuotaAt},cancel_at_period_end=false,
          scheduled_plan_code=null,scheduled_billing_cycle=null,scheduled_contract_months=null,
          scheduled_billing_price_krw=null,scheduled_change_effective_at=null,
          retry_count=0,next_retry_at=null,grace_ends_at=null,canceled_at=null,ended_at=null,
          billing_anchor_day=${anchorDay},payment_provider='toss',provider_schedule_status='active',
          billing_review_status='clear',contract_months=${plan.contractMonths},
          billing_price_krw=${plan.priceKrw},last_charge_at=${startedAt},
          last_charge_failure_code=null,last_charge_failure_message=null,updated_at=clock_timestamp()
        where id=${subscription.id} and user_id=${input.userId} and payment_provider='toss'
      `;
      await tx`
        insert into shorts_mvp.usage_grants (
          user_id,subscription_id,billing_order_id,kind,product_code,total_seconds,
          credited_seconds,carried_seconds,valid_from,expires_at,status
        ) values (
          ${input.userId},${subscription.id},${input.prepared.billingOrderId},'base',${plan.code},
          ${plan.monthlyQuotaSeconds},${plan.monthlyQuotaSeconds},0,${startedAt},
          ${quotaWindow.expiresAt},'active'
        )
        on conflict (subscription_id,valid_from,kind)
          where subscription_id is not null and kind='base'
        do nothing
      `;
      await tx`
        update shorts_mvp.billing_toss_transactions
        set fulfillment_status='applied',fulfillment_failure_message=null,
          fulfilled_at=clock_timestamp(),updated_at=clock_timestamp()
        where id=${ledger.id} and status='succeeded' and fulfillment_status='pending'
      `;
      await syncCachedPlan(tx, input.userId, cachedPlanCodeForTossTier(plan.tier));
      return plan.monthlyQuotaSeconds;
    });
  } catch (error) {
    await markFulfillmentManualReview(
      input.db,
      input.prepared.billingOrderId,
      error instanceof Error ? error.message : "사용량 지급을 확인하지 못했습니다.",
    );
    throw new HttpError(
      503,
      "결제는 승인되었지만 구독 반영을 확인하고 있습니다. 다시 결제하지 마세요.",
      "TOSS_FULFILLMENT_RECONCILIATION_REQUIRED",
    );
  }
}

async function runPreparedCharge(input: {
  db: Sql;
  userId: string;
  prepared: PreparedTossCharge;
  replaceExistingGrant: boolean;
  charge?: Parameters<typeof executeRecordedTossCharge>[0]["charge"];
}): Promise<TossSubscriptionMutationResult> {
  const paymentMethod = await loadTossPaymentMethod(
    input.db,
    input.userId,
    input.prepared.paymentMethodId,
  );
  const billingKey = decryptPaymentMethodBillingKey(paymentMethod);
  const chargeResult: TossRecordedChargeResult = await executeRecordedTossCharge({
    db: input.db,
    userId: input.userId,
    billingOrderId: input.prepared.billingOrderId,
    subscriptionId: input.prepared.subscriptionId,
    paymentMethodId: input.prepared.paymentMethodId,
    providerOrderId: input.prepared.providerOrderId,
    idempotencyKey: `toss-charge:${input.prepared.requestId}`,
    billingKey,
    customerKey: paymentMethod.providerCustomerKey,
    amountKrw: input.prepared.amountKrw,
    orderName: input.prepared.orderName,
    charge: input.charge,
  });
  if (chargeResult.state === "reconciliation_required") {
    return {
      state: "reconciliation_required",
      subscriptionId: input.prepared.subscriptionId,
      planCode: input.prepared.targetPlanCode,
    };
  }
  if (chargeResult.state === "failed") {
    return {
      state: "failed",
      subscriptionId: input.prepared.subscriptionId,
      planCode: input.prepared.targetPlanCode,
    };
  }
  const remainingSeconds = await applyTossEntitlement({
    db: input.db,
    userId: input.userId,
    prepared: input.prepared,
    replaceExistingGrant: input.replaceExistingGrant,
  });
  return {
    state: "succeeded",
    subscriptionId: input.prepared.subscriptionId,
    planCode: input.prepared.targetPlanCode,
    remainingSeconds,
  };
}

export async function startTossSubscription(input: {
  userId: string;
  paymentMethodId: string;
  requestId: string;
  targetPlanCode: TossPlanCode;
  db?: Sql;
  charge?: Parameters<typeof executeRecordedTossCharge>[0]["charge"];
}) {
  const db = input.db ?? getDb();
  const prepared = await prepareInitialPurchase({ ...input, db });
  return runPreparedCharge({
    db,
    userId: input.userId,
    prepared,
    replaceExistingGrant: false,
    charge: input.charge,
  });
}

export async function changeTossSubscription(input: {
  userId: string;
  requestId: string;
  targetPlanCode: TossPlanCode;
  db?: Sql;
  charge?: Parameters<typeof executeRecordedTossCharge>[0]["charge"];
}) {
  const db = input.db ?? getDb();
  const target = tossPlan(input.targetPlanCode);
  const prepared = await db.begin(async (tx): Promise<
    | { action: "unchanged"; subscriptionId: string }
    | { action: "scheduled"; subscriptionId: string; effectiveAt: Date }
    | { action: "immediate"; prepared: PreparedTossCharge }
  > => {
    await lockTossCustomer(tx, input.userId);
    await assertStoredTossPlan(tx, target);
    const current = await loadCurrentTossSubscription(tx, input.userId, true);
    if (!current || current.status !== "active") {
      throw new HttpError(409, "변경할 토스 구독을 찾지 못했습니다.", "TOSS_ACTIVE_SUBSCRIPTION_NOT_FOUND");
    }
    if (current.planCode === target.code) {
      return {
        action: "unchanged" as const,
        subscriptionId: current.id,
      };
    }
    const action = classifyTossSubscriptionChange({
      currentPlanCode: current.planCode,
      targetPlanCode: target.code,
    });
    if (action === "scheduled") {
      await tx`
        update shorts_mvp.user_subscriptions
        set scheduled_plan_code=${target.code},scheduled_billing_cycle='monthly',
          scheduled_contract_months=${target.contractMonths},
          scheduled_billing_price_krw=${target.priceKrw},
          scheduled_change_effective_at=current_period_end,updated_at=clock_timestamp()
        where id=${current.id} and user_id=${input.userId} and payment_provider='toss'
      `;
      return {
        action,
        subscriptionId: current.id,
        effectiveAt: current.currentPeriodEnd,
      };
    }
    const quote = quoteImmediateTossChange({
      currentPlanCode: current.planCode,
      targetPlanCode: target.code,
      currentPeriodStart: current.currentPeriodStart,
      currentPeriodEnd: current.currentPeriodEnd,
    });
    if (quote.chargeAmountKrw < 100) {
      throw new HttpError(
        409,
        "현재 시점에는 즉시 전환 금액이 100원 미만입니다. 계약 종료일부터 변경해 주세요.",
        "TOSS_CHANGE_AMOUNT_BELOW_MINIMUM",
      );
    }
    await loadTossPaymentMethod(tx, input.userId, current.paymentMethodId, true);
    const reserved = await tx`
      select coalesce(sum(reserved_seconds),0)::integer as reserved_seconds
      from shorts_mvp.usage_grants
      where subscription_id=${current.id} and kind='base' and status='active'
    `;
    if (Number(reserved[0]?.reservedSeconds ?? 0) > 0) {
      throw new HttpError(
        409,
        "처리 중인 영상이 끝난 뒤 요금제를 전환해 주세요.",
        "TOSS_USAGE_RESERVATION_ACTIVE",
      );
    }
    const orderName = `${target.displayName} 구독 전환`;
    const order = await createPendingTossOrder({
      db: tx,
      userId: input.userId,
      subscriptionId: current.id,
      paymentMethodId: current.paymentMethodId,
      requestId: input.requestId,
      kind: "subscription_change",
      plan: target,
      amountKrw: quote.chargeAmountKrw,
      orderName,
    });
    return {
      action: "immediate",
      prepared: {
        billingOrderId: order.billingOrderId,
        subscriptionId: current.id,
        paymentMethodId: current.paymentMethodId,
        providerOrderId: order.providerOrderId,
        requestId: input.requestId,
        amountKrw: quote.chargeAmountKrw,
        orderName,
        targetPlanCode: target.code,
      } satisfies PreparedTossCharge,
    };
  });

  if (prepared.action === "unchanged") {
    return {
      state: "unchanged",
      subscriptionId: prepared.subscriptionId,
      planCode: target.code,
    } satisfies TossSubscriptionMutationResult;
  }
  if (prepared.action === "scheduled") {
    return {
      state: "scheduled",
      subscriptionId: prepared.subscriptionId,
      planCode: target.code,
      effectiveAt: prepared.effectiveAt,
    } satisfies TossSubscriptionMutationResult;
  }
  return runPreparedCharge({
    db,
    userId: input.userId,
    prepared: prepared.prepared,
    replaceExistingGrant: true,
    charge: input.charge,
  });
}

export async function cancelScheduledTossSubscriptionChange(input: {
  userId: string;
  db?: Sql;
}) {
  const db = input.db ?? getDb();
  return db.begin(async (tx) => {
    await lockTossCustomer(tx, input.userId);
    const current = await loadCurrentTossSubscription(tx, input.userId, true);
    if (!current || current.status !== "active") {
      throw new HttpError(409, "변경 예약을 취소할 구독을 찾지 못했습니다.");
    }
    await tx`
      update shorts_mvp.user_subscriptions
      set scheduled_plan_code=null,scheduled_billing_cycle=null,
        scheduled_contract_months=null,scheduled_billing_price_krw=null,
        scheduled_change_effective_at=null,updated_at=clock_timestamp()
      where id=${current.id} and user_id=${input.userId} and payment_provider='toss'
    `;
    return { subscriptionId: current.id };
  });
}

export async function setTossSubscriptionCancellation(input: {
  userId: string;
  cancelAtPeriodEnd: boolean;
  db?: Sql;
}) {
  const db = input.db ?? getDb();
  return db.begin(async (tx) => {
    await lockTossCustomer(tx, input.userId);
    const current = await loadCurrentTossSubscription(tx, input.userId, true);
    if (!current || current.status !== "active") {
      throw new HttpError(409, "해지할 토스 구독을 찾지 못했습니다.");
    }
    if (input.cancelAtPeriodEnd) {
      await tx`
        update shorts_mvp.user_subscriptions
        set cancel_at_period_end=true,canceled_at=clock_timestamp(),
          scheduled_plan_code=null,scheduled_billing_cycle=null,
          scheduled_contract_months=null,scheduled_billing_price_krw=null,
          scheduled_change_effective_at=null,updated_at=clock_timestamp()
        where id=${current.id} and user_id=${input.userId} and payment_provider='toss'
      `;
    } else {
      await tx`
        update shorts_mvp.user_subscriptions
        set cancel_at_period_end=false,canceled_at=null,updated_at=clock_timestamp()
        where id=${current.id} and user_id=${input.userId} and payment_provider='toss'
      `;
    }
    return {
      subscriptionId: current.id,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
      accessUntil: current.currentPeriodEnd,
    };
  });
}
