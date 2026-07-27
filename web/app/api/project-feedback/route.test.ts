import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.session,
}));

import { GET, POST } from "./route";

const userId = "6f856acc-5b6a-4f62-9971-d7feb1f2a624";
const requestId = "276a287d-8531-4cb5-9918-5811b12148e4";
const grantId = "f20f73f0-324a-4ddf-b29c-2bfed934e4f7";

function sqlWithRows(...responses: unknown[][]) {
  const sql = vi.fn();
  for (const response of responses) sql.mockResolvedValueOnce(response);
  return sql;
}

function usageRow() {
  return [{
    baseLimitSeconds: 3600,
    baseUsedSeconds: 600,
    baseReservedSeconds: 0,
    addonLimitSeconds: 1800,
    addonUsedSeconds: 0,
    addonReservedSeconds: 0,
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    nextResetAt: new Date("2026-08-01T00:00:00.000Z"),
  }];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    id: "session-id",
    selectedPlanCode: "easycut_pro_v2",
    userId,
    user: null,
  });
});

describe("project feedback API", () => {
  it("returns the first prompt after one completed project", async () => {
    mocks.getDb.mockReturnValue(sqlWithRows([{
      completedProjectCount: 1,
      submitted: false,
      lastDeferredPromptCompletionCount: null,
    }]));

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      eligible: true,
      completedProjectCount: 1,
      promptCompletionCount: 1,
      rewardSeconds: 1800,
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("stores one response and returns the newly granted 30 minutes", async () => {
    const tx = sqlWithRows(
      [],
      [],
      [{
        completedProjectCount: 3,
        submitted: false,
        lastDeferredPromptCompletionCount: 1,
      }],
      [{ id: grantId }],
      [],
    );
    const db = sqlWithRows(usageRow());
    Object.assign(db, {
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });
    mocks.getDb.mockReturnValue(db);

    const response = await POST(new Request("http://localhost/api/project-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId,
        satisfactionRating: 4,
        disappointmentReason: "slow_generation",
        improvementText: "생성 진행 상황을 더 자세히 보고 싶어요.",
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      submitted: true,
      rewardSeconds: 1800,
      rewardValidityDays: 90,
      usage: {
        addonRemainingSeconds: 1800,
        remainingSeconds: 4800,
      },
    });
    expect(tx).toHaveBeenCalledTimes(5);
  });

  it("rejects an invalid satisfaction score before accessing the database", async () => {
    const response = await POST(new Request("http://localhost/api/project-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId,
        satisfactionRating: 6,
        disappointmentReason: "other",
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
