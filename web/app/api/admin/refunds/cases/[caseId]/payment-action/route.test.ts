import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  assertBillingMutationRequest: vi.fn(),
  getDb: vi.fn(),
  executeRecordedTossCancellation: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  requireAdminUser: mocks.requireAdminUser,
}));
vi.mock("@/lib/billing-request", () => ({
  assertBillingMutationRequest: mocks.assertBillingMutationRequest,
}));
vi.mock("@/lib/db", () => ({
  getDb: mocks.getDb,
}));
vi.mock("@/lib/toss-billing-ledger", () => ({
  executeRecordedTossCancellation: mocks.executeRecordedTossCancellation,
}));

import { POST } from "./route";

const caseId = "d9766955-a413-4eaf-a8a6-39a323b35979";
const adminId = "850a1122-2dc5-481f-9c1b-147d6e5addaa";
const userId = "306cc651-88b9-4ca2-bab9-9db44c17436a";
const billingOrderId = "8e0b78f7-a1c3-4cd6-bb77-bec6cb3b792c";
const rootTransactionId = "17a10155-97e2-4f6e-9871-3fd21ba0ade8";
const cancellationTransactionId = "bcd85420-8b13-46a8-8512-68dc1ee3f00f";

function request() {
  return new Request(`https://www.easycut.co.kr/api/admin/refunds/cases/${caseId}/payment-action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation: "토스 환불 실행" }),
  });
}

function database(provider: "toss" | "thepayone" = "toss") {
  const statements: string[] = [];
  const tx = Object.assign(vi.fn(async (strings: TemplateStringsArray) => {
    const statement = strings.join("?");
    statements.push(statement);
    if (statement.includes("select c.*") && statement.includes("billing_orders")) {
      return [{
        id: caseId,
        billingOrderId,
        userId,
        provider,
        status: "open",
        paymentStatus: "not_started",
        providerReference: null,
        plannedRefundKrw: 12_000,
        amountKrw: 30_000,
        refundedAmountKrw: 0,
        reasonDetail: "고객 요청",
        billingAction: "none",
        entitlementAction: "none",
        serviceActionStatus: "not_started",
      }];
    }
    if (statement.includes("from shorts_mvp.billing_toss_transactions")) {
      return [{
        id: rootTransactionId,
        providerOrderId: "TOSS-ROOT-ORDER",
        status: "succeeded",
        amountKrw: 30_000,
        canceledAmountKrw: 0,
      }];
    }
    if (statement.includes("select *") && statement.includes("admin_refund_cases")) {
      return [{
        id: caseId,
        status: "in_progress",
        paymentStatus: "submitted",
        billingAction: "none",
        entitlementAction: "none",
        serviceActionStatus: "not_started",
      }];
    }
    if (
      statement.includes("update shorts_mvp.admin_refund_cases")
      && statement.includes("provider_reference")
    ) {
      return [{ id: caseId, status: "completed", paymentStatus: "completed" }];
    }
    return [];
  }), {
    json: (value: unknown) => value,
  });
  const db = Object.assign(vi.fn(), {
    begin: vi.fn(async (callback: (sql: typeof tx) => Promise<unknown>) => callback(tx)),
  });
  return { db, statements };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminUser.mockResolvedValue({ id: adminId, email: "admin@example.com" });
  mocks.executeRecordedTossCancellation.mockResolvedValue({
    state: "succeeded",
    transaction: { id: cancellationTransactionId },
  });
});

describe("administrator Toss refund action", () => {
  it("records the provider-backed cancellation and completes the case", async () => {
    const { db, statements } = database();
    mocks.getDb.mockReturnValue(db);

    const response = await POST(request(), {
      params: Promise.resolve({ caseId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      state: "succeeded",
      providerReference: cancellationTransactionId,
    });
    expect(mocks.executeRecordedTossCancellation).toHaveBeenCalledWith(expect.objectContaining({
      userId,
      rootTransactionId,
      idempotencyKey: `refund-case-${caseId}`,
      cancelAmountKrw: 12_000,
    }));
    expect(statements.filter((statement) => (
      statement.includes("insert into shorts_mvp.admin_refund_case_events")
    ))).toHaveLength(2);
    expect(statements.filter((statement) => (
      statement.includes("insert into shorts_mvp.admin_audit_logs")
    ))).toHaveLength(2);
  });

  it("never sends a legacy-provider refund to Toss", async () => {
    const { db } = database("thepayone");
    mocks.getDb.mockReturnValue(db);

    const response = await POST(request(), {
      params: Promise.resolve({ caseId }),
    });

    expect(response.status).toBe(409);
    expect(mocks.executeRecordedTossCancellation).not.toHaveBeenCalled();
  });
});
