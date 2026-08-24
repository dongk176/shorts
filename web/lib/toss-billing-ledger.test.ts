import { describe, expect, it } from "vitest";
import {
  assertTossChargeOwnership,
  confirmedTossCancellation,
  tossFailureRetryDelaySeconds,
  tossPaymentResponseSummary,
} from "@/lib/toss-billing-ledger";
import type { TossBillingPaymentResponse } from "@/lib/toss-billing-api";

const payment: TossBillingPaymentResponse = {
  paymentKey: "payment-key",
  orderId: "order-123456",
  orderName: "이지컷 구독",
  status: "DONE",
  totalAmount: 119_400,
  balanceAmount: 119_400,
  approvedAt: "2026-08-20T00:00:00+09:00",
  requestedAt: "2026-08-20T00:00:00+09:00",
  method: "카드",
  lastTransactionKey: "transaction-key",
  card: {
    issuerCode: "61",
    acquirerCode: "61",
    number: "43368900****310*",
    cardType: "신용",
    ownerType: "개인",
  },
  cancels: [],
};

describe("Toss billing ledger", () => {
  it("refuses to attach a Toss charge to any legacy billing row", () => {
    const valid = {
      userId: "user-1",
      amountKrw: 119_400,
      requiresSubscription: true,
      order: { userId: "user-1", provider: "toss", amountKrw: 119_400, status: "pending" },
      paymentMethod: { userId: "user-1", provider: "toss" },
      subscription: { userId: "user-1", paymentProvider: "toss" },
    } as const;
    expect(() => assertTossChargeOwnership(valid)).not.toThrow();
    expect(() => assertTossChargeOwnership({
      ...valid,
      order: { ...valid.order, provider: "thepayone" },
    })).toThrow();
    expect(() => assertTossChargeOwnership({
      ...valid,
      paymentMethod: { ...valid.paymentMethod, provider: "thepayone" },
    })).toThrow();
    expect(() => assertTossChargeOwnership({
      ...valid,
      subscription: { ...valid.subscription, paymentProvider: "thepayone" },
    })).toThrow();
  });

  it("never persists a card number in the response summary", () => {
    const summary = tossPaymentResponseSummary(payment);
    expect(summary).not.toHaveProperty("number");
    expect(JSON.stringify(summary)).not.toContain("43368900");
    expect(summary.issuerCode).toBe("61");
  });

  it("reconciles unknown outcomes before any retry", () => {
    expect(tossFailureRetryDelaySeconds({
      attemptNo: 1,
      outcomeUnknown: true,
      retryable: true,
    })).toBe(60);
  });

  it("does not retry a definitive non-retryable decline", () => {
    expect(tossFailureRetryDelaySeconds({
      attemptNo: 1,
      outcomeUnknown: false,
      retryable: false,
    })).toBeNull();
  });

  it("backs off definitive retryable failures", () => {
    expect(tossFailureRetryDelaySeconds({ attemptNo: 1, outcomeUnknown: false, retryable: true })).toBe(300);
    expect(tossFailureRetryDelaySeconds({ attemptNo: 2, outcomeUnknown: false, retryable: true })).toBe(1_800);
    expect(tossFailureRetryDelaySeconds({ attemptNo: 4, outcomeUnknown: false, retryable: true })).toBe(21_600);
  });

  it("confirms the exact cancellation returned by Toss", () => {
    const canceledPayment: TossBillingPaymentResponse = {
      ...payment,
      status: "PARTIAL_CANCELED",
      balanceAmount: 99_400,
      lastTransactionKey: "cancel-transaction",
      cancels: [{
        transactionKey: "cancel-transaction",
        cancelAmount: 20_000,
        cancelReason: "고객 요청",
        canceledAt: "2026-08-20T01:00:00+09:00",
        cancelStatus: "DONE",
      }],
    };
    expect(confirmedTossCancellation({
      payment: canceledPayment,
      expectedPaymentKey: payment.paymentKey,
      expectedOrderId: payment.orderId,
      expectedTotalAmountKrw: payment.totalAmount,
      preCanceledAmountKrw: 0,
      cancelAmountKrw: 20_000,
      directProviderResponse: true,
    })).toEqual({ transactionKey: "cancel-transaction", postCanceledAmountKrw: 20_000 });
  });

  it("refuses an ambiguous cancellation during reconciliation", () => {
    const ambiguousPayment: TossBillingPaymentResponse = {
      ...payment,
      status: "PARTIAL_CANCELED",
      balanceAmount: 79_400,
      lastTransactionKey: "other-cancel",
      cancels: [
        {
          transactionKey: "expected-cancel",
          cancelAmount: 20_000,
          cancelReason: "고객 요청",
          canceledAt: "2026-08-20T01:00:00+09:00",
          cancelStatus: "DONE",
        },
        {
          transactionKey: "other-cancel",
          cancelAmount: 20_000,
          cancelReason: "관리자 요청",
          canceledAt: "2026-08-20T01:01:00+09:00",
          cancelStatus: "DONE",
        },
      ],
    };
    expect(confirmedTossCancellation({
      payment: ambiguousPayment,
      expectedPaymentKey: payment.paymentKey,
      expectedOrderId: payment.orderId,
      expectedTotalAmountKrw: payment.totalAmount,
      preCanceledAmountKrw: 0,
      cancelAmountKrw: 20_000,
      directProviderResponse: false,
    })).toBeNull();
  });

  it("never accepts a cancellation for another payment", () => {
    expect(confirmedTossCancellation({
      payment: {
        ...payment,
        paymentKey: "another-payment",
        status: "CANCELED",
        balanceAmount: 0,
        lastTransactionKey: "cancel-all",
        cancels: [{
          transactionKey: "cancel-all",
          cancelAmount: payment.totalAmount,
          cancelReason: "고객 요청",
          canceledAt: "2026-08-20T01:00:00+09:00",
          cancelStatus: "DONE",
        }],
      },
      expectedPaymentKey: payment.paymentKey,
      expectedOrderId: payment.orderId,
      expectedTotalAmountKrw: payment.totalAmount,
      preCanceledAmountKrw: 0,
      cancelAmountKrw: payment.totalAmount,
      directProviderResponse: true,
    })).toBeNull();
  });
});
