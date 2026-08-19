import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { assertPersistedTossBillingCustomer } from "@/lib/billing-cohort";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import {
  assertTossBillingChargesEnabled,
  tossBillingClientKey,
} from "@/lib/toss-billing-config";
import {
  registerTossBillingKey,
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

export async function prepareTossCheckout(input: {
  userId: string;
  targetPlanCode: TossPlanCode;
  db?: Sql;
  requestId?: string;
}) {
  assertTossBillingChargesEnabled();
  const db = input.db ?? getDb();
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
    clientKey: tossBillingClientKey(),
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

function checkoutFailure(error: unknown) {
  if (error instanceof HttpError) {
    return {
      status: error.status >= 500 ? "manual_review" : "failed",
      code: error.code,
      message: error.message,
    } as const;
  }
  return {
    status: "manual_review",
    code: "TOSS_CHECKOUT_UNCERTAIN",
    message: "결제 처리 결과를 직접 확인해야 합니다.",
  } as const;
}

export async function completeTossCheckout(input: {
  userId: string;
  requestId: string;
  customerKey: string;
  authKey: string;
  db?: Sql;
}) {
  assertTossBillingChargesEnabled();
  const db = input.db ?? getDb();
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
    const status = result.state === "succeeded" ? "succeeded" : "manual_review";
    await db`
      update shorts_mvp.billing_toss_checkout_intents
      set status=${status},subscription_id=${result.subscriptionId},
        result_summary=${db.json(summary)},completed_at=case when ${status}='succeeded'
          then clock_timestamp() else completed_at end,
        failure_code=case when ${status}='succeeded' then null else 'TOSS_CHECKOUT_RECONCILIATION_REQUIRED' end,
        failure_message=case when ${status}='succeeded' then null else '결제 결과를 직접 확인해야 합니다.' end
      where id=${intent.id} and user_id=${input.userId}
    `;
    return summary;
  } catch (error) {
    const failure = checkoutFailure(error);
    await db`
      update shorts_mvp.billing_toss_checkout_intents
      set status=${failure.status},failure_code=${failure.code},failure_message=${failure.message.slice(0, 300)}
      where id=${intent.id} and user_id=${input.userId} and status<>'succeeded'
    `;
    throw error;
  }
}
