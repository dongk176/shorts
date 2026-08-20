import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { assertPersistedTossBillingCustomer } from "@/lib/billing-cohort";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { tossBillingCheckoutKeys } from "@/lib/toss-billing-config";
import { reconcileUnknownTossPayment } from "@/lib/toss-billing-ledger";
import { assertTossRuntimeChargesEnabled } from "@/lib/toss-billing-runtime";
import {
  fulfillTossInitialOrder,
  registerTossBillingKey,
  retireFailedTossInitialAttempt,
  startTossSubscription,
  type TossSubscriptionMutationResult,
} from "@/lib/toss-billing-service";
import { tossPlan, type TossPlanCode } from "@/lib/toss-subscription";

type BillingDb = Sql | TransactionSql;

type CheckoutIntentRow = {
  id: string;
  requestId: string;
  userId: string;
  providerCustomerKey: string;
  targetPlanCode: TossPlanCode;
  status: string;
  paymentMethodId: string | null;
  subscriptionId: string | null;
  resultSummary: Record<string, unknown> | null;
  expiresAt: Date;
};

type InitialCheckoutAttemptRow = {
  billingOrderId: string | null;
  subscriptionId: string | null;
  transactionId: string | null;
  transactionStatus: string | null;
  fulfillmentStatus: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  nextRetryAt: Date | null;
  transactionRequestedAt: Date | null;
  transactionUpdatedAt: Date | null;
};

export type TossCheckoutResult = {
  state: TossSubscriptionMutationResult["state"];
  subscriptionId: string;
  planCode: TossPlanCode;
  remainingSeconds?: number;
};

function resultFromSummary(row: CheckoutIntentRow): TossCheckoutResult {
  const summary = row.resultSummary ?? {};
  const state = typeof summary.state === "string" ? summary.state : null;
  if (
    state !== "succeeded"
    && state !== "scheduled"
    && state !== "unchanged"
    && state !== "reconciliation_required"
    && state !== "failed"
  ) {
    throw new HttpError(409, "결제 완료 정보를 확인하고 있습니다.", "TOSS_CHECKOUT_RESULT_PENDING");
  }
  const subscriptionId = typeof summary.subscriptionId === "string"
    ? summary.subscriptionId
    : row.subscriptionId;
  if (!subscriptionId) {
    throw new HttpError(409, "결제 완료 정보를 확인하고 있습니다.", "TOSS_CHECKOUT_RESULT_PENDING");
  }
  const result: TossCheckoutResult = {
    state,
    subscriptionId,
    planCode: row.targetPlanCode,
  };
  if (typeof summary.remainingSeconds === "number") {
    result.remainingSeconds = summary.remainingSeconds;
  }
  return result;
}

async function lockCheckoutCustomer(db: BillingDb, userId: string) {
  await db`select pg_advisory_xact_lock(hashtextextended(${`toss-checkout:${userId}`},0))`;
  return assertPersistedTossBillingCustomer(userId, db);
}

async function checkoutIntent(
  db: BillingDb,
  userId: string,
  requestId: string,
  lock = false,
) {
  const rows = lock
    ? await db`
        select id,request_id,user_id,provider_customer_key,target_plan_code,status,
          payment_method_id,subscription_id,result_summary,expires_at
        from shorts_mvp.billing_toss_checkout_intents
        where request_id=${requestId} and user_id=${userId}
        limit 1 for update
      `
    : await db`
        select id,request_id,user_id,provider_customer_key,target_plan_code,status,
          payment_method_id,subscription_id,result_summary,expires_at
        from shorts_mvp.billing_toss_checkout_intents
        where request_id=${requestId} and user_id=${userId}
        limit 1
      `;
  return rows[0] as CheckoutIntentRow | undefined;
}

async function initialCheckoutAttempt(
  db: BillingDb,
  userId: string,
  requestId: string,
) {
  const rows = await db`
    select billing_order.id as billing_order_id,
      billing_order.subscription_id,
      transaction.id as transaction_id,
      transaction.status as transaction_status,
      transaction.fulfillment_status,
      transaction.failure_code,
      transaction.failure_message,
      transaction.next_retry_at,
      transaction.requested_at as transaction_requested_at,
      transaction.updated_at as transaction_updated_at
    from shorts_mvp.billing_toss_checkout_intents intent
    left join shorts_mvp.billing_orders billing_order
      on billing_order.request_id=intent.request_id
     and billing_order.user_id=intent.user_id
     and billing_order.kind='subscription_initial'
     and billing_order.provider='toss'
    left join lateral (
      select id,status,fulfillment_status,failure_code,failure_message,
        next_retry_at,requested_at,updated_at
      from shorts_mvp.billing_toss_transactions
      where billing_order_id=billing_order.id and transaction_type='payment'
      order by created_at desc
      limit 1
    ) transaction on true
    where intent.request_id=${requestId} and intent.user_id=${userId}
    limit 1
  `;
  return rows[0] as InitialCheckoutAttemptRow | undefined;
}

export type TossInitialCheckoutStatus =
  | { state: "succeeded"; subscriptionId: string; planCode: TossPlanCode; remainingSeconds: number }
  | { state: "failed"; message: string }
  | { state: "pending" }
  | { state: "manual_review" };

export function initialAttemptDueForLookup(attempt: InitialCheckoutAttemptRow, now: Date) {
  if (attempt.transactionStatus === "unknown") {
    return !attempt.nextRetryAt || attempt.nextRetryAt <= now;
  }
  return attempt.transactionStatus === "processing"
    && Boolean(attempt.transactionUpdatedAt)
    && attempt.transactionUpdatedAt!.getTime() <= now.getTime() - 120_000;
}

export function checkoutIntentStatusForResult(
  state: TossSubscriptionMutationResult["state"],
) {
  if (state === "succeeded") return "succeeded" as const;
  if (state === "failed") return "failed" as const;
  return "manual_review" as const;
}

export function tossCheckoutHttpStatus(state: TossSubscriptionMutationResult["state"]) {
  if (state === "reconciliation_required") return 202;
  if (state === "failed") return 402;
  return 200;
}

async function finishFailedInitialCheckout(input: {
  db: Sql;
  intent: CheckoutIntentRow;
  attempt: InitialCheckoutAttemptRow;
  retire?: typeof retireFailedTossInitialAttempt;
}) {
  await (input.retire ?? retireFailedTossInitialAttempt)({
    userId: input.intent.userId,
    subscriptionId: input.attempt.subscriptionId,
    db: input.db,
  });
  const message = input.attempt.failureMessage
    || "카드 승인이 완료되지 않았습니다. 결제수단을 확인하고 다시 시도해 주세요.";
  await input.db`
    update shorts_mvp.billing_toss_checkout_intents
    set status='failed',subscription_id=coalesce(subscription_id,${input.attempt.subscriptionId}),
      result_summary=${input.db.json({ state: "failed" })},
      failure_code=${input.attempt.failureCode || "TOSS_PAYMENT_FAILED"},
      failure_message=${message.slice(0, 300)},completed_at=clock_timestamp()
    where id=${input.intent.id} and user_id=${input.intent.userId} and status<>'succeeded'
  `;
  return { state: "failed", message } as const;
}

export async function reconcileTossInitialCheckout(input: {
  userId: string;
  requestId: string;
  db?: Sql;
  lookup?: Parameters<typeof reconcileUnknownTossPayment>[0]["lookup"];
  reconcile?: typeof reconcileUnknownTossPayment;
  fulfill?: typeof fulfillTossInitialOrder;
  retire?: typeof retireFailedTossInitialAttempt;
  now?: Date;
}): Promise<TossInitialCheckoutStatus> {
  const db = input.db ?? getDb();
  const now = input.now ?? new Date();
  const intent = await checkoutIntent(db, input.userId, input.requestId);
  if (!intent) {
    throw new HttpError(404, "결제 요청을 찾지 못했습니다.", "TOSS_CHECKOUT_NOT_FOUND");
  }
  if (intent.status === "succeeded") {
    const result = resultFromSummary(intent);
    if (result.state !== "succeeded") return { state: "manual_review" };
    return {
      state: "succeeded",
      subscriptionId: result.subscriptionId,
      planCode: result.planCode,
      remainingSeconds: result.remainingSeconds ?? 0,
    };
  }
  if (intent.status === "failed" || intent.status === "expired") {
    return {
      state: "failed",
      message: "카드 승인이 완료되지 않았습니다. 결제수단을 확인하고 다시 시도해 주세요.",
    };
  }

  let attempt = await initialCheckoutAttempt(db, input.userId, input.requestId);
  if (!attempt?.transactionId) {
    return intent.status === "manual_review" ? { state: "manual_review" } : { state: "pending" };
  }
  if (
    attempt.transactionStatus === "unknown"
    && attempt.transactionRequestedAt
    && attempt.transactionRequestedAt.getTime() <= now.getTime() - 30 * 60_000
  ) {
    await db`
      update shorts_mvp.billing_toss_checkout_intents
      set status='manual_review',failure_code='TOSS_CHECKOUT_RECONCILIATION_ESCALATED',
        failure_message='결제 결과가 장시간 확정되지 않아 직접 확인이 필요합니다.'
      where id=${intent.id} and user_id=${input.userId} and status<>'succeeded'
    `;
    return { state: "manual_review" };
  }
  if (initialAttemptDueForLookup(attempt, now)) {
    await (input.reconcile ?? reconcileUnknownTossPayment)({
      transactionId: attempt.transactionId,
      db,
      lookup: input.lookup,
    });
    attempt = await initialCheckoutAttempt(db, input.userId, input.requestId);
    if (!attempt?.transactionId) return { state: "manual_review" };
  }

  if (attempt.transactionStatus === "failed") {
    return finishFailedInitialCheckout({ db, intent, attempt, retire: input.retire });
  }
  if (attempt.transactionStatus !== "succeeded" || !attempt.billingOrderId) {
    return { state: "pending" };
  }
  if (attempt.fulfillmentStatus === "manual_review") {
    return { state: "manual_review" };
  }
  try {
    const result = await (input.fulfill ?? fulfillTossInitialOrder)({
      userId: input.userId,
      billingOrderId: attempt.billingOrderId,
      db,
    });
    const summary = {
      state: result.state,
      subscriptionId: result.subscriptionId,
      planCode: result.planCode,
      remainingSeconds: result.remainingSeconds,
    };
    await db`
      update shorts_mvp.billing_toss_checkout_intents
      set status='succeeded',subscription_id=${result.subscriptionId},
        result_summary=${db.json(summary)},failure_code=null,failure_message=null,
        completed_at=clock_timestamp()
      where id=${intent.id} and user_id=${input.userId} and status<>'succeeded'
    `;
    return summary;
  } catch {
    await db`
      update shorts_mvp.billing_toss_checkout_intents
      set status='manual_review',subscription_id=coalesce(subscription_id,${attempt.subscriptionId}),
        failure_code='TOSS_FULFILLMENT_RECONCILIATION_REQUIRED',
        failure_message='승인된 결제의 구독 반영을 직접 확인해야 합니다.'
      where id=${intent.id} and user_id=${input.userId} and status<>'succeeded'
    `;
    return { state: "manual_review" };
  }
}

export async function processTossInitialCheckoutReconciliations(
  db: Sql,
  options: { now?: Date; limit?: number } = {},
) {
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const rows = await db`
    select distinct intent.user_id,intent.request_id
    from shorts_mvp.billing_toss_checkout_intents intent
    join shorts_mvp.billing_orders billing_order
      on billing_order.request_id=intent.request_id
     and billing_order.user_id=intent.user_id
     and billing_order.kind='subscription_initial'
     and billing_order.provider='toss'
    join shorts_mvp.billing_toss_transactions transaction
      on transaction.billing_order_id=billing_order.id
     and transaction.transaction_type='payment'
    where intent.status='manual_review'
      and coalesce(intent.failure_code,'')<>'TOSS_CHECKOUT_RECONCILIATION_ESCALATED'
      and (
        transaction.status='succeeded'
        or (transaction.status='unknown'
          and coalesce(transaction.next_retry_at,transaction.updated_at)<=${now})
        or (transaction.status='processing'
          and transaction.updated_at<=${new Date(now.getTime() - 120_000)})
      )
    order by intent.request_id
    limit ${limit}
  `;
  const results: TossInitialCheckoutStatus[] = [];
  for (const row of rows) {
    try {
      results.push(await reconcileTossInitialCheckout({
        userId: String(row.userId),
        requestId: String(row.requestId),
        db,
        now,
      }));
    } catch {
      results.push({ state: "manual_review" });
    }
  }
  return {
    scanned: rows.length,
    succeeded: results.filter((result) => result.state === "succeeded").length,
    failed: results.filter((result) => result.state === "failed").length,
    pending: results.filter((result) => result.state === "pending").length,
    manualReview: results.filter((result) => result.state === "manual_review").length,
  };
}

export async function prepareTossCheckout(input: {
  userId: string;
  targetPlanCode: TossPlanCode;
  db?: Sql;
  requestId?: string;
}) {
  const db = input.db ?? getDb();
  await assertTossRuntimeChargesEnabled(db);
  // A known provider decline is safe to close and must not strand the customer
  // behind the one-current-subscription constraint.
  await retireFailedTossInitialAttempt({ userId: input.userId, db });
  // Validate the complete billing key pair before persisting an intent. This
  // prevents an unusable card-registration request from being left behind.
  const { clientKey } = tossBillingCheckoutKeys();
  const plan = tossPlan(input.targetPlanCode);
  const requestId = input.requestId ?? randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1_000);

  const prepared = await db.begin(async (tx) => {
    const cohort = await lockCheckoutCustomer(tx, input.userId);
    const existing = await checkoutIntent(tx, input.userId, requestId, true);
    if (existing) {
      if (
        existing.providerCustomerKey !== cohort.providerCustomerKey
        || existing.targetPlanCode !== plan.code
      ) {
        throw new HttpError(409, "같은 요청번호가 다른 상품과 충돌했습니다.", "TOSS_CHECKOUT_REQUEST_CONFLICT");
      }
      if (existing.status !== "prepared" || existing.expiresAt.getTime() <= Date.now()) {
        throw new HttpError(409, "카드등록 요청이 만료되었습니다. 다시 시도해 주세요.", "TOSS_CHECKOUT_EXPIRED");
      }
      return existing;
    }

    const subscriptions = await tx`
      select id
      from shorts_mvp.user_subscriptions
      where user_id=${input.userId} and payment_provider='toss'
        and status in ('pending','trialing','active','past_due')
      limit 1 for update
    `;
    if (subscriptions[0]) {
      throw new HttpError(409, "이미 이용 중인 토스 구독이 있습니다.", "TOSS_SUBSCRIPTION_ALREADY_EXISTS");
    }

    const inserted = await tx`
      insert into shorts_mvp.billing_toss_checkout_intents (
        id,request_id,user_id,cohort,provider_customer_key,target_plan_code,
        purpose,status,expires_at
      ) values (
        ${requestId},${requestId},${input.userId},'toss_v1',${cohort.providerCustomerKey},
        ${plan.code},'subscription_start','prepared',${expiresAt}
      )
      returning id,request_id,user_id,provider_customer_key,target_plan_code,status,
        payment_method_id,subscription_id,result_summary,expires_at
    `;
    return inserted[0] as CheckoutIntentRow;
  });

  return {
    requestId: prepared.requestId,
    customerKey: prepared.providerCustomerKey,
    clientKey,
    orderName: `${plan.displayName} 구독`,
    plan: {
      code: plan.code,
      displayName: plan.displayName,
      contractMonths: plan.contractMonths,
      priceKrw: plan.priceKrw,
    },
    expiresAt: prepared.expiresAt.toISOString(),
  };
}

export async function completeTossCheckout(input: {
  userId: string;
  requestId: string;
  customerKey: string;
  authKey: string;
  db?: Sql;
}) {
  const db = input.db ?? getDb();
  await assertTossRuntimeChargesEnabled(db);
  let intent = await db.begin(async (tx) => {
    const cohort = await lockCheckoutCustomer(tx, input.userId);
    const row = await checkoutIntent(tx, input.userId, input.requestId, true);
    if (!row) {
      throw new HttpError(404, "카드등록 요청을 찾지 못했습니다.", "TOSS_CHECKOUT_NOT_FOUND");
    }
    if (
      row.providerCustomerKey !== cohort.providerCustomerKey
      || row.providerCustomerKey !== input.customerKey
    ) {
      throw new HttpError(409, "카드등록 고객 정보가 일치하지 않습니다.", "TOSS_CHECKOUT_CUSTOMER_MISMATCH");
    }
    if (row.status === "succeeded") return row;
    if (row.status === "processing") {
      throw new HttpError(409, "결제를 처리하고 있습니다. 잠시 후 확인해 주세요.", "TOSS_CHECKOUT_PROCESSING", 2);
    }
    if (row.status === "manual_review") {
      throw new HttpError(409, "결제 결과를 확인하고 있습니다. 다시 결제하지 마세요.", "TOSS_CHECKOUT_MANUAL_REVIEW");
    }
    if (row.status === "failed" || row.status === "expired") {
      throw new HttpError(409, "카드등록 요청이 종료되었습니다. 다시 시도해 주세요.", "TOSS_CHECKOUT_CLOSED");
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      await tx`
        update shorts_mvp.billing_toss_checkout_intents
        set status='expired',failure_code='TOSS_CHECKOUT_EXPIRED',
          failure_message='카드등록 요청 유효시간이 만료되었습니다.'
        where id=${row.id}
      `;
      throw new HttpError(409, "카드등록 요청이 만료되었습니다. 다시 시도해 주세요.", "TOSS_CHECKOUT_EXPIRED");
    }
    if (row.status === "prepared") {
      await tx`
        update shorts_mvp.billing_toss_checkout_intents
        set status='processing',failure_code=null,failure_message=null
        where id=${row.id} and status='prepared'
      `;
      row.status = "processing";
    }
    return row;
  });

  if (intent.status === "succeeded") return resultFromSummary(intent);

  try {
    const paymentMethod = intent.paymentMethodId
      ? { id: intent.paymentMethodId }
      : await registerTossBillingKey({
          userId: input.userId,
          authKey: input.authKey,
          paymentMethodId: intent.id,
          db,
        });
    if (!intent.paymentMethodId) {
      await db`
        update shorts_mvp.billing_toss_checkout_intents
        set status='payment_method_registered',payment_method_id=${paymentMethod.id}
        where id=${intent.id} and user_id=${input.userId}
      `;
      intent = { ...intent, status: "payment_method_registered", paymentMethodId: paymentMethod.id };
    }

    const result = await startTossSubscription({
      userId: input.userId,
      paymentMethodId: paymentMethod.id,
      requestId: intent.requestId,
      targetPlanCode: intent.targetPlanCode,
      db,
    });
    const summary = {
      state: result.state,
      subscriptionId: result.subscriptionId,
      planCode: result.planCode,
      ...(result.state === "succeeded" ? { remainingSeconds: result.remainingSeconds } : {}),
    };
    const status = checkoutIntentStatusForResult(result.state);
    await db`
      update shorts_mvp.billing_toss_checkout_intents
      set status=${status},subscription_id=${result.subscriptionId},
        result_summary=${db.json(summary)},completed_at=case when ${status} in ('succeeded','failed')
          then clock_timestamp() else completed_at end,
        failure_code=case
          when ${status}='succeeded' then null
          when ${status}='failed' then 'TOSS_PAYMENT_FAILED'
          else 'TOSS_CHECKOUT_RECONCILIATION_REQUIRED'
        end,
        failure_message=case
          when ${status}='succeeded' then null
          when ${status}='failed' then '카드 승인이 완료되지 않았습니다.'
          else '결제 결과를 직접 확인해야 합니다.'
        end
      where id=${intent.id} and user_id=${input.userId}
    `;
    if (result.state === "failed") {
      await retireFailedTossInitialAttempt({
        userId: input.userId,
        subscriptionId: result.subscriptionId,
        db,
      });
    }
    return summary;
  } catch (error) {
    const attempt = await initialCheckoutAttempt(db, input.userId, input.requestId);
    if (attempt?.transactionStatus === "failed") {
      return finishFailedInitialCheckout({ db, intent, attempt });
    }
    if (!attempt?.transactionId) {
      const message = error instanceof Error
        ? error.message
        : "카드등록을 완료하지 못했습니다. 다시 시도해 주세요.";
      await db`
        update shorts_mvp.billing_toss_checkout_intents
        set status='failed',failure_code='TOSS_PAYMENT_METHOD_REGISTRATION_FAILED',
          failure_message=${message.slice(0, 300)},completed_at=clock_timestamp()
        where id=${intent.id} and user_id=${input.userId} and status<>'succeeded'
      `;
      throw new HttpError(
        409,
        "카드등록을 완료하지 못했습니다. 다시 시도해 주세요.",
        "TOSS_PAYMENT_METHOD_REGISTRATION_FAILED",
      );
    }
    await db`
      update shorts_mvp.billing_toss_checkout_intents
      set status='manual_review',subscription_id=coalesce(subscription_id,${attempt.subscriptionId}),
        failure_code='TOSS_CHECKOUT_RECONCILIATION_REQUIRED',
        failure_message='결제 처리 결과를 다시 확인하고 있습니다.'
      where id=${intent.id} and user_id=${input.userId} and status<>'succeeded'
    `;
    if (!attempt.subscriptionId) throw error;
    return {
      state: "reconciliation_required" as const,
      subscriptionId: attempt.subscriptionId,
      planCode: intent.targetPlanCode,
    };
  }
}
