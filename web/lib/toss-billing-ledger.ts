import type { Sql, TransactionSql } from "postgres";
import { getDb } from "@/lib/db";
import { assertTossRuntimeChargesEnabled } from "@/lib/toss-billing-runtime";
import { assertPersistedTossBillingCustomer } from "@/lib/billing-cohort";
import {
  cancelTossPayment,
  chargeTossBilling,
  getTossPaymentByOrderId,
  TossBillingApiError,
  type TossBillingPaymentResponse,
} from "@/lib/toss-billing-api";

export type TossLedgerStatus =
  | "requested"
  | "processing"
  | "succeeded"
  | "failed"
  | "unknown"
  | "canceled"
  | "partial_canceled";

export type TossPaymentLedgerRow = {
  id: string;
  userId: string;
  billingOrderId: string | null;
  subscriptionId: string | null;
  paymentMethodId: string | null;
  providerOrderId: string;
  idempotencyKey: string | null;
  amountKrw: number;
  attemptNo: number;
  status: TossLedgerStatus;
  requestedAt: Date;
};

export type TossCancellationLedgerRow = TossPaymentLedgerRow & {
  rootTransactionId: string;
  paymentKey: string;
};

export type TossRecordedChargeResult =
  | { state: "succeeded"; transaction: TossPaymentLedgerRow; payment: TossBillingPaymentResponse }
  | { state: "already_succeeded"; transaction: TossPaymentLedgerRow }
  | { state: "reconciliation_required"; transaction: TossPaymentLedgerRow }
  | { state: "failed"; transaction: TossPaymentLedgerRow };

export type TossRecordedCancellationResult =
  | { state: "succeeded"; transaction: TossCancellationLedgerRow; payment: TossBillingPaymentResponse }
  | { state: "already_succeeded"; transaction: TossCancellationLedgerRow }
  | { state: "reconciliation_required"; transaction: TossCancellationLedgerRow }
  | { state: "failed"; transaction: TossCancellationLedgerRow };

type TossChargeOwnership = {
  order: { userId: string; provider: string; amountKrw: number; status: string } | undefined;
  paymentMethod: { userId: string; provider: string } | undefined;
  subscription?: { userId: string; paymentProvider: string | null } | undefined;
};

export function assertTossChargeOwnership(input: TossChargeOwnership & {
  userId: string;
  amountKrw: number;
  requiresSubscription: boolean;
}) {
  if (
    !input.order
    || input.order.userId !== input.userId
    || input.order.provider !== "toss"
    || input.order.amountKrw !== input.amountKrw
    || !["pending", "processing", "succeeded", "failed", "unknown", "manual_review"].includes(
      input.order.status,
    )
  ) throw new Error("토스 전용 결제 주문을 확인하지 못했습니다.");
  if (
    !input.paymentMethod
    || input.paymentMethod.userId !== input.userId
    || input.paymentMethod.provider !== "toss"
  ) throw new Error("토스 전용 결제수단을 확인하지 못했습니다.");
  if (
    input.requiresSubscription
    && (
      !input.subscription
      || input.subscription.userId !== input.userId
      || input.subscription.paymentProvider !== "toss"
    )
  ) throw new Error("토스 전용 구독을 확인하지 못했습니다.");
}

function boundedText(value: unknown, max = 300) {
  return typeof value === "string" ? value.slice(0, max) : null;
}

export function tossPaymentResponseSummary(payment: TossBillingPaymentResponse) {
  return {
    orderId: payment.orderId,
    status: payment.status,
    totalAmount: payment.totalAmount,
    balanceAmount: payment.balanceAmount,
    approvedAt: payment.approvedAt,
    requestedAt: payment.requestedAt,
    method: payment.method,
    issuerCode: payment.card?.issuerCode ?? null,
    acquirerCode: payment.card?.acquirerCode ?? null,
    cardType: payment.card?.cardType ?? null,
    ownerType: payment.card?.ownerType ?? null,
    cancellationCount: payment.cancels.length,
  };
}

function totalCanceledAmount(payment: TossBillingPaymentResponse) {
  return payment.cancels
    .filter((item) => item.cancelStatus === "DONE")
    .reduce((sum, item) => sum + item.cancelAmount, 0);
}

export function confirmedTossCancellation(input: {
  payment: TossBillingPaymentResponse;
  expectedPaymentKey: string;
  expectedOrderId: string;
  expectedTotalAmountKrw: number;
  preCanceledAmountKrw: number;
  cancelAmountKrw: number;
  directProviderResponse: boolean;
}) {
  const { payment } = input;
  if (
    payment.paymentKey !== input.expectedPaymentKey
    || payment.orderId !== input.expectedOrderId
    || payment.totalAmount !== input.expectedTotalAmountKrw
    || !["PARTIAL_CANCELED", "CANCELED"].includes(payment.status)
  ) return null;
  const postCanceledAmountKrw = totalCanceledAmount(payment);
  const expectedPostCanceled = input.preCanceledAmountKrw + input.cancelAmountKrw;
  if (postCanceledAmountKrw < expectedPostCanceled) return null;

  const byLastTransaction = payment.lastTransactionKey
    ? payment.cancels.find((item) => (
      item.transactionKey === payment.lastTransactionKey
      && item.cancelStatus === "DONE"
      && item.cancelAmount === input.cancelAmountKrw
    ))
    : undefined;
  if (input.directProviderResponse && byLastTransaction?.transactionKey) {
    return { transactionKey: byLastTransaction.transactionKey, postCanceledAmountKrw };
  }
  if (postCanceledAmountKrw !== expectedPostCanceled) return null;
  const candidates = payment.cancels.filter((item) => (
    item.transactionKey
    && item.cancelStatus === "DONE"
    && item.cancelAmount === input.cancelAmountKrw
  ));
  if (candidates.length !== 1) return null;
  return { transactionKey: candidates[0].transactionKey as string, postCanceledAmountKrw };
}

export function tossFailureRetryDelaySeconds(input: {
  attemptNo: number;
  outcomeUnknown: boolean;
  retryable: boolean;
}) {
  if (input.outcomeUnknown) return 60;
  if (!input.retryable) return null;
  return [300, 1_800, 7_200, 21_600][Math.min(3, Math.max(0, input.attemptNo - 1))];
}

function validateExistingAttempt(
  row: TossPaymentLedgerRow,
  input: {
    userId: string;
    billingOrderId: string;
    providerOrderId: string;
    idempotencyKey: string;
    amountKrw: number;
  },
) {
  if (
    row.userId !== input.userId
    || row.billingOrderId !== input.billingOrderId
    || row.providerOrderId !== input.providerOrderId
    || row.idempotencyKey !== input.idempotencyKey
    || row.amountKrw !== input.amountKrw
  ) {
    throw new Error("토스 결제 멱등성 키가 다른 결제 요청과 충돌했습니다.");
  }
}

async function loadPaymentAttempt(
  db: Sql | TransactionSql,
  providerOrderId: string,
) {
  const rows = await db`
    select id,user_id,billing_order_id,subscription_id,payment_method_id,
      provider_order_id,idempotency_key,amount_krw,attempt_no,status,requested_at
    from shorts_mvp.billing_toss_transactions
    where transaction_type='payment' and provider_order_id=${providerOrderId}
    limit 1
  `;
  return rows[0] as TossPaymentLedgerRow | undefined;
}

async function loadCancellationAttempt(
  db: Sql | TransactionSql,
  providerOrderId: string,
) {
  const rows = await db`
    select id,root_transaction_id,user_id,billing_order_id,subscription_id,payment_method_id,
      provider_order_id,payment_key,idempotency_key,amount_krw,attempt_no,status,requested_at
    from shorts_mvp.billing_toss_transactions
    where transaction_type='cancellation' and provider_order_id=${providerOrderId}
    limit 1
  `;
  return rows[0] as TossCancellationLedgerRow | undefined;
}

async function claimCancellationAttempt(input: {
  db: Sql;
  userId: string;
  rootTransactionId: string;
  providerOrderId: string;
  idempotencyKey: string;
  cancelAmountKrw: number;
  attemptNo: number;
}) {
  return input.db.begin(async (tx) => {
    await assertPersistedTossBillingCustomer(input.userId, tx);
    const rootRows = await tx`
      select id,user_id,billing_order_id,subscription_id,payment_method_id,
        provider_order_id,payment_key,amount_krw,canceled_amount_krw,status
      from shorts_mvp.billing_toss_transactions
      where id=${input.rootTransactionId} and transaction_type='payment'
      for update
    `;
    const root = rootRows[0] as {
      id: string;
      userId: string;
      billingOrderId: string | null;
      subscriptionId: string | null;
      paymentMethodId: string | null;
      providerOrderId: string;
      paymentKey: string | null;
      amountKrw: number;
      canceledAmountKrw: number;
      status: TossLedgerStatus;
    } | undefined;
    if (!root || root.userId !== input.userId || !root.paymentKey) {
      throw new Error("취소할 토스 결제를 찾지 못했습니다.");
    }

    const existing = await loadCancellationAttempt(tx, input.providerOrderId);
    if (existing) {
      if (
        existing.userId !== input.userId
        || existing.rootTransactionId !== input.rootTransactionId
        || existing.idempotencyKey !== input.idempotencyKey
        || existing.amountKrw !== input.cancelAmountKrw
      ) throw new Error("토스 취소 멱등성 키가 다른 요청과 충돌했습니다.");
      return {
        claimed: false,
        transaction: existing,
        root,
        preCanceledAmountKrw: root.canceledAmountKrw,
      } as const;
    }

    if (root.status !== "succeeded" && root.status !== "partial_canceled") {
      throw new Error("취소할 수 있는 결제 상태가 아닙니다.");
    }
    const availableAmountKrw = root.amountKrw - root.canceledAmountKrw;
    if (
      !Number.isSafeInteger(input.cancelAmountKrw)
      || input.cancelAmountKrw < 1
      || input.cancelAmountKrw > availableAmountKrw
    ) throw new Error("취소 가능 금액을 초과했습니다.");

    await tx`
      insert into shorts_mvp.billing_toss_transactions (
        root_transaction_id,user_id,billing_order_id,subscription_id,payment_method_id,
        transaction_type,provider_order_id,payment_key,idempotency_key,amount_krw,
        status,attempt_no,fulfillment_status,response_summary
      ) values (
        ${root.id},${input.userId},${root.billingOrderId},${root.subscriptionId},
        ${root.paymentMethodId},'cancellation',${input.providerOrderId},${root.paymentKey},
        ${input.idempotencyKey},${input.cancelAmountKrw},'requested',${input.attemptNo},
        'pending',${tx.json({ preCanceledAmountKrw: root.canceledAmountKrw })}
      )
      on conflict do nothing
    `;
    const inserted = await loadCancellationAttempt(tx, input.providerOrderId);
    if (!inserted) {
      const inflight = await tx`
        select id from shorts_mvp.billing_toss_transactions
        where root_transaction_id=${root.id} and transaction_type='cancellation'
          and status in ('requested','processing','unknown')
        limit 1
      `;
      if (inflight[0]) throw new Error("이 결제의 이전 취소 요청을 확인하고 있습니다.");
      throw new Error("토스 취소 장부를 생성하지 못했습니다.");
    }
    const claimedRows = await tx`
      update shorts_mvp.billing_toss_transactions
      set status='processing',updated_at=clock_timestamp()
      where id=${inserted.id} and status='requested'
      returning id,root_transaction_id,user_id,billing_order_id,subscription_id,payment_method_id,
        provider_order_id,payment_key,idempotency_key,amount_krw,attempt_no,status,requested_at
    `;
    const transaction = claimedRows[0] as TossCancellationLedgerRow | undefined;
    if (!transaction) throw new Error("토스 취소 요청을 선점하지 못했습니다.");
    return {
      claimed: true,
      transaction,
      root,
      preCanceledAmountKrw: root.canceledAmountKrw,
    } as const;
  });
}

async function markCancellationSucceeded(input: {
  db: Sql;
  transaction: TossCancellationLedgerRow;
  root: {
    providerOrderId: string;
    paymentKey: string | null;
    amountKrw: number;
  };
  preCanceledAmountKrw: number;
  payment: TossBillingPaymentResponse;
  directProviderResponse: boolean;
  reconciled: boolean;
}) {
  if (!input.root.paymentKey) throw new Error("원 결제 식별자가 없습니다.");
  const confirmed = confirmedTossCancellation({
    payment: input.payment,
    expectedPaymentKey: input.root.paymentKey,
    expectedOrderId: input.root.providerOrderId,
    expectedTotalAmountKrw: input.root.amountKrw,
    preCanceledAmountKrw: input.preCanceledAmountKrw,
    cancelAmountKrw: input.transaction.amountKrw,
    directProviderResponse: input.directProviderResponse,
  });
  if (!confirmed) {
    await markCancellationFailed({
      db: input.db,
      transaction: input.transaction,
      code: "CANCEL_RESULT_AMBIGUOUS",
      message: "취소 결과와 내부 취소 요청을 자동으로 대조하지 못했습니다.",
      retryable: false,
      outcomeUnknown: true,
      manualReview: true,
    });
    throw new Error("취소 결과를 직접 확인해야 합니다.");
  }
  const fullyCanceled = confirmed.postCanceledAmountKrw === input.root.amountKrw;
  const summary = {
    ...tossPaymentResponseSummary(input.payment),
    preCanceledAmountKrw: input.preCanceledAmountKrw,
    postCanceledAmountKrw: confirmed.postCanceledAmountKrw,
  };
  await input.db.begin(async (tx) => {
    const updated = await tx`
      update shorts_mvp.billing_toss_transactions
      set status='succeeded',transaction_key=${confirmed.transactionKey},
        failure_code=null,failure_message=null,next_retry_at=null,
        outcome_reconciled_at=${input.reconciled ? new Date() : null},
        response_summary=${tx.json(summary)},approved_at=clock_timestamp(),
        completed_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=${input.transaction.id} and status in ('processing','unknown')
    `;
    if (updated.count === 0) {
      const current = await loadCancellationAttempt(tx, input.transaction.providerOrderId);
      if (current?.status !== "succeeded") throw new Error("토스 취소 상태를 저장하지 못했습니다.");
    }
    await tx`
      update shorts_mvp.billing_toss_transactions
      set canceled_amount_krw=${confirmed.postCanceledAmountKrw},
        status=${fullyCanceled ? "canceled" : "partial_canceled"},
        response_summary=${tx.json(tossPaymentResponseSummary(input.payment))},
        updated_at=clock_timestamp()
      where id=${input.transaction.rootTransactionId} and transaction_type='payment'
    `;
    if (input.transaction.billingOrderId) await tx`
      update shorts_mvp.billing_orders
      set refunded_amount_krw=${confirmed.postCanceledAmountKrw},
        refund_status=${fullyCanceled ? "full" : "partial"},
        status=${fullyCanceled ? "canceled" : "succeeded"},
        provider_status=${input.payment.status},failure_code=null,failure_message=null
      where id=${input.transaction.billingOrderId} and user_id=${input.transaction.userId}
        and provider='toss'
    `;
  });
}

async function markCancellationFailed(input: {
  db: Sql;
  transaction: TossCancellationLedgerRow;
  code: string;
  message: string;
  retryable: boolean;
  outcomeUnknown: boolean;
  manualReview?: boolean;
}) {
  const delaySeconds = input.manualReview
    ? null
    : tossFailureRetryDelaySeconds({
      attemptNo: input.transaction.attemptNo,
      outcomeUnknown: input.outcomeUnknown,
      retryable: input.retryable,
    });
  const status = input.outcomeUnknown ? "unknown" : "failed";
  const nextRetryAt = delaySeconds === null ? null : new Date(Date.now() + delaySeconds * 1_000);
  await input.db.begin(async (tx) => {
    await tx`
      update shorts_mvp.billing_toss_transactions
      set status=${status},failure_code=${input.code.slice(0, 100)},
        failure_message=${input.message.slice(0, 300)},next_retry_at=${nextRetryAt},
        fulfillment_status=${input.manualReview ? "manual_review" : "pending"},
        completed_at=${input.outcomeUnknown ? null : new Date()},updated_at=clock_timestamp()
      where id=${input.transaction.id} and status in ('requested','processing','unknown')
    `;
    if (input.manualReview && input.transaction.billingOrderId) await tx`
      update shorts_mvp.billing_orders
      set refund_status='manual_review'
      where id=${input.transaction.billingOrderId} and provider='toss'
    `;
  });
}

async function claimPaymentAttempt(input: {
  db: Sql;
  userId: string;
  billingOrderId: string;
  subscriptionId?: string | null;
  paymentMethodId: string;
  providerOrderId: string;
  idempotencyKey: string;
  amountKrw: number;
  attemptNo: number;
}) {
  return input.db.begin(async (tx) => {
    await assertPersistedTossBillingCustomer(input.userId, tx);
    const [orderRows, paymentMethodRows, subscriptionRows] = await Promise.all([
      tx`
        select user_id,provider,amount_krw,status
        from shorts_mvp.billing_orders
        where id=${input.billingOrderId}
        for update
      `,
      tx`
        select user_id,provider
        from shorts_mvp.billing_payment_methods
        where id=${input.paymentMethodId}
        for update
      `,
      input.subscriptionId
        ? tx`
            select user_id,payment_provider
            from shorts_mvp.user_subscriptions
            where id=${input.subscriptionId}
            for update
          `
        : Promise.resolve([]),
    ]);
    assertTossChargeOwnership({
      userId: input.userId,
      amountKrw: input.amountKrw,
      requiresSubscription: Boolean(input.subscriptionId),
      order: orderRows[0] as TossChargeOwnership["order"],
      paymentMethod: paymentMethodRows[0] as TossChargeOwnership["paymentMethod"],
      subscription: subscriptionRows[0] as TossChargeOwnership["subscription"],
    });
    await tx`
      insert into shorts_mvp.billing_toss_transactions (
        user_id,billing_order_id,subscription_id,payment_method_id,
        transaction_type,provider_order_id,idempotency_key,amount_krw,
        status,attempt_no,fulfillment_status
      ) values (
        ${input.userId},${input.billingOrderId},${input.subscriptionId ?? null},
        ${input.paymentMethodId},'payment',${input.providerOrderId},
        ${input.idempotencyKey},${input.amountKrw},'requested',${input.attemptNo},'pending'
      )
      on conflict (provider_order_id) do nothing
    `;
    const existing = await loadPaymentAttempt(tx, input.providerOrderId);
    if (!existing) throw new Error("토스 결제 장부를 생성하지 못했습니다.");
    validateExistingAttempt(existing, input);
    if (existing.status !== "requested") {
      return { claimed: false, transaction: existing } as const;
    }
    const claimedRows = await tx`
      update shorts_mvp.billing_toss_transactions
      set status='processing',updated_at=clock_timestamp()
      where id=${existing.id} and status='requested'
      returning id,user_id,billing_order_id,subscription_id,payment_method_id,
        provider_order_id,idempotency_key,amount_krw,attempt_no,status,requested_at
    `;
    const claimed = claimedRows[0] as TossPaymentLedgerRow | undefined;
    if (!claimed) {
      const current = await loadPaymentAttempt(tx, input.providerOrderId);
      if (!current) throw new Error("토스 결제 장부를 다시 확인하지 못했습니다.");
      return { claimed: false, transaction: current } as const;
    }
    await tx`
      update shorts_mvp.billing_orders
      set status='processing',failure_code=null,failure_message=null
      where id=${input.billingOrderId} and user_id=${input.userId}
        and provider='toss' and amount_krw=${input.amountKrw}
        and status in ('pending','failed')
    `;
    return { claimed: true, transaction: claimed } as const;
  });
}

async function markPaymentSucceeded(input: {
  db: Sql;
  transaction: TossPaymentLedgerRow;
  payment: TossBillingPaymentResponse;
  reconciled: boolean;
}) {
  if (
    input.payment.orderId !== input.transaction.providerOrderId
    || input.payment.totalAmount !== input.transaction.amountKrw
    || input.payment.status !== "DONE"
  ) {
    await markPaymentFailed({
      db: input.db,
      transaction: input.transaction,
      code: "PROVIDER_RESULT_MISMATCH",
      message: "결제사 승인 결과와 내부 주문이 일치하지 않습니다.",
      retryable: false,
      outcomeUnknown: true,
    });
    throw new Error("결제 승인 결과 확인이 필요합니다.");
  }
  const summary = tossPaymentResponseSummary(input.payment);
  await input.db.begin(async (tx) => {
    const updated = await tx`
      update shorts_mvp.billing_toss_transactions
      set status='succeeded',payment_key=${input.payment.paymentKey},
        transaction_key=${input.payment.lastTransactionKey},failure_code=null,
        failure_message=null,next_retry_at=null,
        outcome_reconciled_at=${input.reconciled ? new Date() : null},
        response_summary=${tx.json(summary)},approved_at=${input.payment.approvedAt},
        completed_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=${input.transaction.id} and status in ('processing','unknown')
    `;
    if (updated.count === 0) {
      const current = await loadPaymentAttempt(tx, input.transaction.providerOrderId);
      if (current?.status !== "succeeded") {
        throw new Error("토스 결제 승인 상태를 저장하지 못했습니다.");
      }
    }
    if (input.transaction.billingOrderId) await tx`
      update shorts_mvp.billing_orders
      set status='succeeded',provider='toss',provider_transaction_id=${input.payment.paymentKey},
        provider_status=${input.payment.status},failure_code=null,failure_message=null,
        approved_at=${input.payment.approvedAt}
      where id=${input.transaction.billingOrderId}
        and user_id=${input.transaction.userId} and provider='toss'
        and status in ('processing','unknown','manual_review')
    `;
  });
}

async function markPaymentFailed(input: {
  db: Sql;
  transaction: TossPaymentLedgerRow;
  code: string;
  message: string;
  retryable: boolean;
  outcomeUnknown: boolean;
}) {
  const delaySeconds = tossFailureRetryDelaySeconds({
    attemptNo: input.transaction.attemptNo,
    outcomeUnknown: input.outcomeUnknown,
    retryable: input.retryable,
  });
  const status = input.outcomeUnknown ? "unknown" : "failed";
  const nextRetryAt = delaySeconds === null
    ? null
    : new Date(Date.now() + delaySeconds * 1_000);
  await input.db.begin(async (tx) => {
    await tx`
      update shorts_mvp.billing_toss_transactions
      set status=${status},failure_code=${input.code.slice(0, 100)},
        failure_message=${input.message.slice(0, 300)},
        next_retry_at=${nextRetryAt},
        completed_at=${input.outcomeUnknown ? null : new Date()},updated_at=clock_timestamp()
      where id=${input.transaction.id} and status in ('requested','processing','unknown')
    `;
    if (input.transaction.billingOrderId) await tx`
      update shorts_mvp.billing_orders
      set status=${status},provider='toss',failure_code=${input.code.slice(0, 100)},
        failure_message=${input.message.slice(0, 300)}
      where id=${input.transaction.billingOrderId}
        and user_id=${input.transaction.userId} and provider='toss'
        and status in ('pending','processing','unknown')
    `;
  });
}

function normalizedFailure(error: unknown) {
  if (error instanceof TossBillingApiError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      outcomeUnknown: error.outcomeUnknown,
    };
  }
  return {
    code: "UNEXPECTED_CHARGE_ERROR",
    message: boundedText(error instanceof Error ? error.message : null) || "결제 요청을 처리하지 못했습니다.",
    retryable: false,
    outcomeUnknown: true,
  };
}

export async function executeRecordedTossCharge(input: {
  db?: Sql;
  userId: string;
  billingOrderId: string;
  subscriptionId?: string | null;
  paymentMethodId: string;
  providerOrderId: string;
  idempotencyKey: string;
  attemptNo?: number;
  billingKey: string;
  customerKey: string;
  amountKrw: number;
  orderName: string;
  charge?: typeof chargeTossBilling;
}): Promise<TossRecordedChargeResult> {
  const db = input.db ?? getDb();
  await assertTossRuntimeChargesEnabled(db);
  const claimed = await claimPaymentAttempt({
    db,
    userId: input.userId,
    billingOrderId: input.billingOrderId,
    subscriptionId: input.subscriptionId,
    paymentMethodId: input.paymentMethodId,
    providerOrderId: input.providerOrderId,
    idempotencyKey: input.idempotencyKey,
    amountKrw: input.amountKrw,
    attemptNo: input.attemptNo ?? 1,
  });
  if (!claimed.claimed) {
    if (claimed.transaction.status === "succeeded") {
      return { state: "already_succeeded", transaction: claimed.transaction };
    }
    if (claimed.transaction.status === "processing" || claimed.transaction.status === "unknown") {
      return { state: "reconciliation_required", transaction: claimed.transaction };
    }
    return { state: "failed", transaction: claimed.transaction };
  }
  try {
    const payment = await (input.charge ?? chargeTossBilling)({
      billingKey: input.billingKey,
      customerKey: input.customerKey,
      amountKrw: input.amountKrw,
      orderId: input.providerOrderId,
      orderName: input.orderName,
      idempotencyKey: input.idempotencyKey,
    });
    await markPaymentSucceeded({ db, transaction: claimed.transaction, payment, reconciled: false });
    return { state: "succeeded", transaction: claimed.transaction, payment };
  } catch (error) {
    const failure = normalizedFailure(error);
    await markPaymentFailed({ db, transaction: claimed.transaction, ...failure });
    throw error;
  }
}

export async function reconcileUnknownTossPayment(input: {
  transactionId: string;
  db?: Sql;
  lookup?: typeof getTossPaymentByOrderId;
}) {
  const db = input.db ?? getDb();
  const rows = await db`
    select id,user_id,billing_order_id,subscription_id,payment_method_id,
      provider_order_id,idempotency_key,amount_krw,attempt_no,status,requested_at
    from shorts_mvp.billing_toss_transactions
    where id=${input.transactionId} and transaction_type='payment'
    limit 1
  `;
  const transaction = rows[0] as TossPaymentLedgerRow | undefined;
  if (!transaction) return "not_found" as const;
  if (transaction.status === "succeeded") return "already_succeeded" as const;
  if (transaction.status !== "unknown" && transaction.status !== "processing") {
    return "not_reconcilable" as const;
  }
  try {
    const payment = await (input.lookup ?? getTossPaymentByOrderId)(transaction.providerOrderId);
    await markPaymentSucceeded({ db, transaction, payment, reconciled: true });
    return "succeeded" as const;
  } catch (error) {
    const failure = normalizedFailure(error);
    await markPaymentFailed({
      db,
      transaction,
      ...failure,
      // A lookup failure never proves that a charge failed. Keep it unknown so
      // no later worker can issue a second charge for this provider order.
      outcomeUnknown: true,
    });
    return "still_unknown" as const;
  }
}

export async function executeRecordedTossCancellation(input: {
  db?: Sql;
  userId: string;
  rootTransactionId: string;
  providerOrderId: string;
  idempotencyKey: string;
  cancelAmountKrw: number;
  cancelReason: string;
  attemptNo?: number;
  cancel?: typeof cancelTossPayment;
}): Promise<TossRecordedCancellationResult> {
  const db = input.db ?? getDb();
  const claimed = await claimCancellationAttempt({
    db,
    userId: input.userId,
    rootTransactionId: input.rootTransactionId,
    providerOrderId: input.providerOrderId,
    idempotencyKey: input.idempotencyKey,
    cancelAmountKrw: input.cancelAmountKrw,
    attemptNo: input.attemptNo ?? 1,
  });
  if (!claimed.claimed) {
    if (claimed.transaction.status === "succeeded") {
      return { state: "already_succeeded", transaction: claimed.transaction };
    }
    if (claimed.transaction.status === "processing" || claimed.transaction.status === "unknown") {
      return { state: "reconciliation_required", transaction: claimed.transaction };
    }
    return { state: "failed", transaction: claimed.transaction };
  }
  try {
    const payment = await (input.cancel ?? cancelTossPayment)({
      paymentKey: claimed.transaction.paymentKey,
      cancelReason: input.cancelReason,
      cancelAmountKrw: input.cancelAmountKrw,
      idempotencyKey: input.idempotencyKey,
    });
    await markCancellationSucceeded({
      db,
      transaction: claimed.transaction,
      root: claimed.root,
      preCanceledAmountKrw: claimed.preCanceledAmountKrw,
      payment,
      directProviderResponse: true,
      reconciled: false,
    });
    return { state: "succeeded", transaction: claimed.transaction, payment };
  } catch (error) {
    if (error instanceof Error && error.message === "취소 결과를 직접 확인해야 합니다.") throw error;
    const failure = normalizedFailure(error);
    await markCancellationFailed({ db, transaction: claimed.transaction, ...failure });
    throw error;
  }
}

export async function reconcileUnknownTossCancellation(input: {
  transactionId: string;
  db?: Sql;
  lookup?: typeof getTossPaymentByOrderId;
}) {
  const db = input.db ?? getDb();
  const rows = await db`
    select cancellation.id,cancellation.root_transaction_id,cancellation.user_id,
      cancellation.billing_order_id,cancellation.subscription_id,cancellation.payment_method_id,
      cancellation.provider_order_id,cancellation.payment_key,cancellation.idempotency_key,
      cancellation.amount_krw,cancellation.attempt_no,cancellation.status,
      cancellation.requested_at,cancellation.response_summary,
      root.provider_order_id as root_provider_order_id,root.payment_key as root_payment_key,
      root.amount_krw as root_amount_krw
    from shorts_mvp.billing_toss_transactions cancellation
    join shorts_mvp.billing_toss_transactions root
      on root.id=cancellation.root_transaction_id and root.transaction_type='payment'
    where cancellation.id=${input.transactionId}
      and cancellation.transaction_type='cancellation'
    limit 1
  `;
  const row = rows[0] as (TossCancellationLedgerRow & {
    responseSummary: { preCanceledAmountKrw?: unknown };
    rootProviderOrderId: string;
    rootPaymentKey: string;
    rootAmountKrw: number;
  }) | undefined;
  if (!row) return "not_found" as const;
  if (row.status === "succeeded") return "already_succeeded" as const;
  if (row.status !== "unknown" && row.status !== "processing") {
    return "not_reconcilable" as const;
  }
  const preCanceledAmountKrw = Number(row.responseSummary?.preCanceledAmountKrw);
  if (!Number.isSafeInteger(preCanceledAmountKrw) || preCanceledAmountKrw < 0) {
    await markCancellationFailed({
      db,
      transaction: row,
      code: "CANCEL_RECONCILIATION_STATE_INVALID",
      message: "취소 전 금액 상태를 확인할 수 없습니다.",
      retryable: false,
      outcomeUnknown: true,
      manualReview: true,
    });
    return "manual_review" as const;
  }
  try {
    const payment = await (input.lookup ?? getTossPaymentByOrderId)(row.rootProviderOrderId);
    const confirmed = confirmedTossCancellation({
      payment,
      expectedPaymentKey: row.rootPaymentKey,
      expectedOrderId: row.rootProviderOrderId,
      expectedTotalAmountKrw: row.rootAmountKrw,
      preCanceledAmountKrw,
      cancelAmountKrw: row.amountKrw,
      directProviderResponse: false,
    });
    if (!confirmed) {
      await markCancellationFailed({
        db,
        transaction: row,
        code: "CANCEL_RECONCILIATION_PENDING",
        message: "취소 결과가 아직 확정되지 않았습니다.",
        retryable: true,
        outcomeUnknown: true,
      });
      return "still_unknown" as const;
    }
    await markCancellationSucceeded({
      db,
      transaction: row,
      root: {
        providerOrderId: row.rootProviderOrderId,
        paymentKey: row.rootPaymentKey,
        amountKrw: row.rootAmountKrw,
      },
      preCanceledAmountKrw,
      payment,
      directProviderResponse: false,
      reconciled: true,
    });
    return "succeeded" as const;
  } catch (error) {
    if (error instanceof Error && error.message === "취소 결과를 직접 확인해야 합니다.") {
      return "manual_review" as const;
    }
    const failure = normalizedFailure(error);
    await markCancellationFailed({
      db,
      transaction: row,
      ...failure,
      outcomeUnknown: true,
    });
    return "still_unknown" as const;
  }
}
