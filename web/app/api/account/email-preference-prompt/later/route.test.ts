import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.session,
}));

import { POST } from "./route";

const userId = "6f856acc-5b6a-4f62-9971-d7feb1f2a624";

function request() {
  return new Request(
    "http://localhost/api/account/email-preference-prompt/later",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
}

function mutationDb(...responses: unknown[][]) {
  const sql = vi.fn();
  for (const response of responses) sql.mockResolvedValueOnce(response);
  return {
    sql,
    begin: vi.fn(async (callback: (tx: typeof sql) => Promise<unknown>) => callback(sql)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId });
});

describe("email preference prompt later API", () => {
  it("shows the prompt again after three more completed jobs initially", async () => {
    const db = mutationDb(
      [{ id: userId }],
      [{ completedJobCount: 4 }],
      [],
      [],
    );
    mocks.getDb.mockReturnValue(db);

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deferred: true,
      completionDelay: 3,
      nextPromptCompletedJobCount: 7,
    });
    expect(db.sql.mock.calls[3][0].join("?")).toContain(
      "insert into shorts_mvp.email_preference_prompt_snoozes",
    );
  });

  it("shows again at six cumulative completions after the next deferral", async () => {
    const db = mutationDb(
      [{ id: userId }],
      [{ completedJobCount: 7 }],
      [{ snoozeStep: 1 }],
      [],
    );
    mocks.getDb.mockReturnValue(db);

    const response = await POST(request());

    await expect(response.json()).resolves.toEqual({
      deferred: true,
      completionDelay: 3,
      nextPromptCompletedJobCount: 10,
    });
  });

  it("shows again at twelve cumulative completions after the third deferral", async () => {
    const db = mutationDb(
      [{ id: userId }],
      [{ completedJobCount: 10 }],
      [{ snoozeStep: 2 }],
      [],
    );
    mocks.getDb.mockReturnValue(db);

    const response = await POST(request());

    await expect(response.json()).resolves.toEqual({
      deferred: true,
      completionDelay: 6,
      nextPromptCompletedJobCount: 16,
    });
  });
});
