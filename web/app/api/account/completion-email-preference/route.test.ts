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

function sqlWithRows(...responses: unknown[][]) {
  const sql = vi.fn();
  for (const response of responses) sql.mockResolvedValueOnce(response);
  return sql;
}

function mutationDb(...responses: unknown[][]) {
  const sql = sqlWithRows(...responses);
  return {
    sql,
    begin: vi.fn(async (callback: (tx: typeof sql) => Promise<unknown>) => callback(sql)),
  };
}

function decisionRequest(
  status: "enabled" | "declined",
  marketingStatus: "enabled" | "declined" = "declined",
  email?: string,
) {
  return new Request("http://localhost/api/account/completion-email-preference", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, marketingStatus, email }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId });
});

describe("completion email preference API", () => {
  it("treats a missing preference row as not asked", async () => {
    mocks.getDb.mockReturnValue(sqlWithRows([{
      email: "owner@example.com",
      notificationEmail: null,
      completionEmailStatus: null,
      marketingEmailStatus: null,
      completedJobCount: 2,
      nextPromptCompletedJobCount: null,
    }]));

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "not_asked",
      marketingStatus: "not_asked",
      email: "owner@example.com",
      promptDue: true,
      completedJobCount: 2,
      nextPromptCompletedJobCount: null,
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns the edited notification address instead of the account address", async () => {
    mocks.getDb.mockReturnValue(sqlWithRows([{
      email: "owner@example.com",
      notificationEmail: "alerts@example.com",
      completionEmailStatus: null,
      marketingEmailStatus: null,
      completedJobCount: 0,
      nextPromptCompletedJobCount: null,
    }]));

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      email: "alerts@example.com",
    });
  });

  it("stores opt-in and queues an already-running job", async () => {
    const db = mutationDb(
      [{ email: "owner@example.com", notificationEmail: null }],
      [{
        completionEmailStatus: "enabled",
        marketingEmailStatus: "enabled",
      }],
      [],
    );
    mocks.getDb.mockReturnValue(db);

    const response = await POST(
      decisionRequest("enabled", "enabled", " Alerts@Example.com "),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "enabled",
      marketingStatus: "enabled",
      email: "alerts@example.com",
      promptDue: false,
    });
    expect(db.sql).toHaveBeenCalledTimes(4);
    expect(db.sql.mock.calls[2][0].join("?")).toContain(
      "insert into shorts_mvp.job_completion_email_notifications",
    );
    expect(db.sql.mock.calls[1][0].join("?")).toContain("notification_email");
    expect(db.sql.mock.calls[3][0].join("?")).toContain(
      "delete from shorts_mvp.email_preference_prompt_snoozes",
    );
  });

  it("stores 다시 보지 않기 without queueing a job", async () => {
    const db = mutationDb(
      [{ email: "owner@example.com", notificationEmail: null }],
      [{
        completionEmailStatus: "declined",
        marketingEmailStatus: "declined",
      }],
    );
    mocks.getDb.mockReturnValue(db);

    const response = await POST(decisionRequest("declined"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "declined",
      marketingStatus: "declined",
      email: "owner@example.com",
      promptDue: false,
    });
    expect(db.sql).toHaveBeenCalledTimes(3);
  });

  it("does not enable email without an account address", async () => {
    const db = mutationDb([{ email: null, notificationEmail: null }]);
    mocks.getDb.mockReturnValue(db);

    const response = await POST(decisionRequest("enabled"));

    expect(response.status).toBe(409);
    expect(db.sql).toHaveBeenCalledOnce();
  });
});
