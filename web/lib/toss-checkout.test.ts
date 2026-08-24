import type { Sql } from "postgres";
import { describe, expect, it, vi } from "vitest";
import {
  checkoutIntentStatusForResult,
  initialAttemptDueForLookup,
  reconcileTossInitialCheckout,
  tossCheckoutHttpStatus,
} from "@/lib/toss-checkout";

const intent = {
  id: "intent-1",
  requestId: "11111111-1111-4111-8111-111111111111",
  userId: "user-1",
  providerCustomerKey: "EC_customer",
  targetPlanCode: "toss_easycut_pro_1m",
  status: "manual_review",
  paymentMethodId: "method-1",
  subscriptionId: "subscription-1",
  resultSummary: {},
  expiresAt: new Date("2026-08-21T00:15:00.000Z"),
} as const;

function checkoutDb(attempt: Record<string, unknown> | (() => Record<string, unknown>)) {
  const updates: string[] = [];
  const query = async (parts: TemplateStringsArray) => {
    const statement = parts.join(" ");
    if (statement.includes("select id,request_id,user_id,provider_customer_key")) return [intent];
    if (statement.includes("select billing_order.id as billing_order_id")) {
      return [typeof attempt === "function" ? attempt() : attempt];
    }
    if (statement.includes("update shorts_mvp.billing_toss_checkout_intents")) {
      updates.push(statement);
      return Object.assign([], { count: 1 });
    }
    throw new Error(`Unexpected SQL: ${statement}`);
  };
  Object.assign(query, { json: (value: unknown) => value });
  return { db: query as unknown as Sql, updates };
}

describe("initial Toss checkout recovery", () => {
  it("shows a known decline as failed instead of success or manual review", () => {
    expect(checkoutIntentStatusForResult("failed")).toBe("failed");
    expect(tossCheckoutHttpStatus("failed")).toBe(402);
    expect(tossCheckoutHttpStatus("reconciliation_required")).toBe(202);
  });

  it("looks up unknown results only after their persisted retry time", () => {
    const now = new Date("2026-08-21T00:02:00.000Z");
    const base = {
      billingOrderId: "order-1",
      subscriptionId: "subscription-1",
      transactionId: "transaction-1",
      transactionStatus: "unknown",
      fulfillmentStatus: "pending",
      failureCode: null,
      failureMessage: null,
      transactionRequestedAt: new Date("2026-08-21T00:00:00.000Z"),
      transactionUpdatedAt: new Date("2026-08-21T00:00:00.000Z"),
    };
    expect(initialAttemptDueForLookup({
      ...base,
      nextRetryAt: new Date("2026-08-21T00:03:00.000Z"),
    }, now)).toBe(false);
    expect(initialAttemptDueForLookup({
      ...base,
      nextRetryAt: now,
    }, now)).toBe(true);
  });

  it("reconciles by order lookup and fulfills without issuing another charge", async () => {
    let status = "unknown";
    const { db, updates } = checkoutDb(() => ({
      billingOrderId: "order-1",
      subscriptionId: "subscription-1",
      transactionId: "transaction-1",
      transactionStatus: status,
      fulfillmentStatus: "pending",
      failureCode: null,
      failureMessage: null,
      nextRetryAt: new Date("2026-08-21T00:00:00.000Z"),
      transactionRequestedAt: new Date("2026-08-21T00:00:00.000Z"),
      transactionUpdatedAt: new Date("2026-08-21T00:00:00.000Z"),
    }));
    const reconcile = vi.fn(async () => {
      status = "succeeded";
      return "succeeded" as const;
    });
    const fulfill = vi.fn(async () => ({
      state: "succeeded" as const,
      subscriptionId: "subscription-1",
      planCode: "toss_easycut_pro_1m" as const,
      remainingSeconds: 3_600,
    }));
    const result = await reconcileTossInitialCheckout({
      userId: intent.userId,
      requestId: intent.requestId,
      db,
      now: new Date("2026-08-21T00:02:00.000Z"),
      reconcile,
      fulfill,
    });
    expect(reconcile).toHaveBeenCalledOnce();
    expect(fulfill).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ state: "succeeded", remainingSeconds: 3_600 });
    expect(updates).toHaveLength(1);
  });

  it("retires a conclusively failed subscription so the customer can retry", async () => {
    const { db, updates } = checkoutDb({
      billingOrderId: "order-1",
      subscriptionId: "subscription-1",
      transactionId: "transaction-1",
      transactionStatus: "failed",
      fulfillmentStatus: "pending",
      failureCode: "REJECT_CARD_PAYMENT",
      failureMessage: "카드 승인이 거절되었습니다.",
      nextRetryAt: null,
      transactionRequestedAt: new Date("2026-08-21T00:00:00.000Z"),
      transactionUpdatedAt: new Date("2026-08-21T00:00:00.000Z"),
    });
    const retire = vi.fn(async () => true);
    const result = await reconcileTossInitialCheckout({
      userId: intent.userId,
      requestId: intent.requestId,
      db,
      retire,
    });
    expect(retire).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: "subscription-1",
    }));
    expect(result).toEqual({ state: "failed", message: "카드 승인이 거절되었습니다." });
    expect(updates).toHaveLength(1);
  });

  it("escalates a long-running unknown result without sending a second charge", async () => {
    const { db, updates } = checkoutDb({
      billingOrderId: "order-1",
      subscriptionId: "subscription-1",
      transactionId: "transaction-1",
      transactionStatus: "unknown",
      fulfillmentStatus: "pending",
      failureCode: "PROVIDER_TIMEOUT",
      failureMessage: "결제사 응답을 확인하지 못했습니다.",
      nextRetryAt: new Date("2026-08-21T00:01:00.000Z"),
      transactionRequestedAt: new Date("2026-08-21T00:00:00.000Z"),
      transactionUpdatedAt: new Date("2026-08-21T00:01:00.000Z"),
    });
    const reconcile = vi.fn();
    const result = await reconcileTossInitialCheckout({
      userId: intent.userId,
      requestId: intent.requestId,
      db,
      now: new Date("2026-08-21T00:31:00.000Z"),
      reconcile,
    });
    expect(reconcile).not.toHaveBeenCalled();
    expect(result).toEqual({ state: "manual_review" });
    expect(updates).toHaveLength(1);
  });
});
