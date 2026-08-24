import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/session", () => ({ requireMvpSession: mocks.session }));

import { POST } from "./route";

const submission = {
  requestId: "8dedb29b-e003-47e6-9e85-58b3a7d124fc",
  category: "billing_refund",
  contactEmail: "owner@example.com",
  message: "결제 내역과 환불 가능 여부를 확인해 주세요.",
  locale: "ko",
  pagePath: "/",
};

function request(body: unknown) {
  return new Request("http://localhost/api/support/inquiries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "EasyCut Test Browser",
    },
    body: JSON.stringify(body),
  });
}

function inquiryDb({
  existing = [],
  recentCount = 0,
  refundOrderRows = [],
}: {
  existing?: unknown[];
  recentCount?: number;
  refundOrderRows?: unknown[];
} = {}) {
  const tx = vi.fn(async (strings: TemplateStringsArray) => {
    const query = Array.from(strings).join("");
    if (query.includes("pg_advisory_xact_lock")) return [];
    if (query.includes("where request_id=")) return existing;
    if (query.includes("select count(*)::int as count")) return [{ count: recentCount }];
    if (query.includes("from shorts_mvp.billing_orders o")) return refundOrderRows;
    if (query.includes("insert into shorts_mvp.customer_inquiries")) {
      return [{
        id: "e3949f4b-032c-4b96-9443-a28f563749ed",
        createdAt: new Date("2026-07-26T10:00:00.000Z"),
      }];
    }
    throw new Error(`Unexpected query: ${query}`);
  });
  return {
    tx,
    db: {
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    id: "session-a",
    selectedPlanCode: "plus",
    userId: "user-a",
    user: {
      id: "auth-a",
      email: "owner@example.com",
      displayName: null,
      avatarUrl: null,
    },
  });
});

describe("support inquiry API", () => {
  it("stores a new inquiry and returns a searchable reference", async () => {
    const { db, tx } = inquiryDb();
    mocks.getDb.mockReturnValue(db);

    const response = await POST(request(submission));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      submitted: true,
      referenceCode: "EC-E3949F4B",
    });
    const insertCall = tx.mock.calls.find(([strings]) => (
      Array.from(strings as TemplateStringsArray).join("").includes(
        "insert into shorts_mvp.customer_inquiries",
      )
    ));
    expect(insertCall).toBeDefined();
    expect(insertCall?.slice(1)).toEqual(expect.arrayContaining([
      "session-a",
      "user-a",
      "billing_refund",
      "owner@example.com",
      "EasyCut Test Browser",
    ]));
  });

  it("returns the original inquiry when a request is retried", async () => {
    const { db, tx } = inquiryDb({
      existing: [{
        id: "e3949f4b-032c-4b96-9443-a28f563749ed",
        createdAt: new Date("2026-07-26T10:00:00.000Z"),
      }],
    });
    mocks.getDb.mockReturnValue(db);

    const response = await POST(request(submission));

    expect(response.status).toBe(200);
    expect(tx.mock.calls.some(([strings]) => (
      Array.from(strings as TemplateStringsArray).join("").includes(
        "insert into shorts_mvp.customer_inquiries",
      )
    ))).toBe(false);
  });

  it("rate limits repeated submissions from the same session", async () => {
    const { db } = inquiryDb({ recentCount: 5 });
    mocks.getDb.mockReturnValue(db);

    const response = await POST(request(submission));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
    await expect(response.json()).resolves.toMatchObject({
      code: "SUPPORT_INQUIRY_RATE_LIMIT",
    });
  });

  it("links a verified customer order to a refund request", async () => {
    const billingOrderId = "1e9b85a4-5fc6-4910-801d-ad137ce54b8c";
    const { db, tx } = inquiryDb({
      refundOrderRows: [{
        id: billingOrderId,
        remainingRefundableAmountKrw: 19_900,
        hasOpenRefundInquiry: false,
      }],
    });
    mocks.getDb.mockReturnValue(db);

    const response = await POST(request({
      ...submission,
      inquiryKind: "refund_request",
      billingOrderId,
      refundReasonCode: "service_issue",
    }));

    expect(response.status).toBe(201);
    const insertCall = tx.mock.calls.find(([strings]) => (
      Array.from(strings as TemplateStringsArray).join("").includes(
        "insert into shorts_mvp.customer_inquiries",
      )
    ));
    expect(insertCall?.slice(1)).toEqual(expect.arrayContaining([
      "refund_request",
      billingOrderId,
      "service_issue",
    ]));
  });

  it("rejects duplicate open refund requests for the same order", async () => {
    const billingOrderId = "1e9b85a4-5fc6-4910-801d-ad137ce54b8c";
    const { db } = inquiryDb({
      refundOrderRows: [{
        id: billingOrderId,
        remainingRefundableAmountKrw: 19_900,
        hasOpenRefundInquiry: true,
      }],
    });
    mocks.getDb.mockReturnValue(db);

    const response = await POST(request({
      ...submission,
      inquiryKind: "refund_request",
      billingOrderId,
      refundReasonCode: "other",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "REFUND_INQUIRY_ALREADY_OPEN",
    });
  });

  it("requires login before accepting a refund request", async () => {
    mocks.session.mockResolvedValue({
      id: "session-a",
      selectedPlanCode: "free",
      userId: null,
      user: null,
    });

    const response = await POST(request({
      ...submission,
      inquiryKind: "refund_request",
      billingOrderId: "1e9b85a4-5fc6-4910-801d-ad137ce54b8c",
      refundReasonCode: "other",
    }));

    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects invalid content before creating a session", async () => {
    const response = await POST(request({ ...submission, message: "짧음" }));

    expect(response.status).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
