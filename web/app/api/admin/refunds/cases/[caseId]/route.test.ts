import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  requireAdminUser: mocks.requireAdminUser,
}));
vi.mock("@/lib/db", () => ({
  getDb: mocks.getDb,
}));

import { PATCH } from "./route";

const caseId = "d9766955-a413-4eaf-a8a6-39a323b35979";

function request() {
  return new Request(`https://www.easycut.co.kr/api/admin/refunds/cases/${caseId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://www.easycut.co.kr",
    },
    body: JSON.stringify({
      status: "completed",
      paymentStatus: "completed",
      providerReference: "MANUAL-REFUND-100",
      adminNote: "카드사 환불 확인 후 상태만 기록",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminUser.mockResolvedValue({
    id: "850a1122-2dc5-481f-9c1b-147d6e5addaa",
    email: "admin@example.com",
  });
});

describe("administrator refund case status API", () => {
  it("changes only the operational case and audit records", async () => {
    const statements: string[] = [];
    const tx = Object.assign(vi.fn(async (strings: TemplateStringsArray) => {
      const statement = strings.join("?");
      statements.push(statement);
      if (statement.includes("select c.*") && statement.includes("admin_refund_cases")) {
        return [{
          id: caseId,
          status: "in_progress",
          paymentStatus: "submitted",
          provider: "thepayone",
          providerReference: null,
        }];
      }
      if (statement.includes("update shorts_mvp.admin_refund_cases")) {
        return [{ id: caseId, status: "completed", paymentStatus: "completed" }];
      }
      return [];
    }), {
      json: (value: unknown) => value,
    });
    const db = Object.assign(vi.fn(), {
      begin: vi.fn(async (callback: (sql: typeof tx) => Promise<unknown>) => callback(tx)),
    });
    mocks.getDb.mockReturnValue(db);

    const response = await PATCH(request(), {
      params: Promise.resolve({ caseId }),
    });
    const responseBody = await response.json();

    expect({ status: response.status, body: responseBody }).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect(statements.some((statement) => statement.includes("admin_refund_cases"))).toBe(true);
    expect(statements.some((statement) => statement.includes("admin_refund_case_events"))).toBe(true);
    expect(statements.some((statement) => statement.includes("admin_audit_logs"))).toBe(true);
    expect(statements.some((statement) => statement.includes("update shorts_mvp.billing_orders"))).toBe(false);
    expect(statements.some((statement) => statement.includes("admin_billing_refunds"))).toBe(false);
  });

  it("rejects a manual Toss payment-status override", async () => {
    const statements: string[] = [];
    const tx = Object.assign(vi.fn(async (strings: TemplateStringsArray) => {
      const statement = strings.join("?");
      statements.push(statement);
      if (statement.includes("select c.*") && statement.includes("admin_refund_cases")) {
        return [{
          id: caseId,
          status: "open",
          paymentStatus: "not_started",
          provider: "toss",
          providerReference: null,
          billingAction: "none",
          entitlementAction: "none",
          serviceActionStatus: "not_started",
        }];
      }
      return [];
    }), {
      json: (value: unknown) => value,
    });
    const db = Object.assign(vi.fn(), {
      begin: vi.fn(async (callback: (sql: typeof tx) => Promise<unknown>) => callback(tx)),
    });
    mocks.getDb.mockReturnValue(db);

    const response = await PATCH(request(), {
      params: Promise.resolve({ caseId }),
    });

    expect(response.status).toBe(409);
    expect(statements.some((statement) => statement.includes("update shorts_mvp.admin_refund_cases"))).toBe(false);
  });
});
