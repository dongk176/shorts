import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.session,
}));

import { GET, POST } from "./route";

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

const originalApiKey = process.env.RESEND_API_KEY;
const originalFromEmail = process.env.RESEND_FROM_EMAIL;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "test-key";
  process.env.RESEND_FROM_EMAIL = "Easy Cut <notifications@example.com>";
  mocks.session.mockResolvedValue({
    userId: "6f856acc-5b6a-4f62-9971-d7feb1f2a624",
  });
});

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalApiKey;
  if (originalFromEmail === undefined) delete process.env.RESEND_FROM_EMAIL;
  else process.env.RESEND_FROM_EMAIL = originalFromEmail;
});

describe("completion email preference API", () => {
  it("prompts only an onboarding v2 account when infrastructure is configured", async () => {
    mocks.getDb.mockReturnValue(sqlWithRows([{
      email: "owner@example.com",
      notificationEmail: null,
      completionEmailStatus: null,
      marketingEmailStatus: null,
      onboardingVersion: 2,
      completedJobCount: 2,
      nextPromptCompletedJobCount: null,
    }]));

    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({
      available: true,
      status: "not_asked",
      marketingStatus: "not_asked",
      promptDue: true,
    });
  });

  it("never prompts an existing onboarding v1 account", async () => {
    mocks.getDb.mockReturnValue(sqlWithRows([{
      email: "owner@example.com",
      onboardingVersion: 1,
      completedJobCount: 10,
    }]));

    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({
      available: true,
      promptDue: false,
    });
  });

  it("skips the prompt and rejects mutation when email infrastructure is disabled", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    mocks.getDb.mockReturnValue(sqlWithRows([{
      email: "owner@example.com",
      onboardingVersion: 2,
      completedJobCount: 1,
    }]));

    const getResponse = await GET();
    await expect(getResponse.json()).resolves.toMatchObject({
      available: false,
      promptDue: false,
    });

    const postResponse = await POST(new Request(
      "http://localhost/api/account/completion-email-preference",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "enabled",
          marketingStatus: "declined",
        }),
      },
    ));
    expect(postResponse.status).toBe(503);
  });

  it("stores explicit v2 choices without defaulting marketing consent", async () => {
    const db = mutationDb(
      [{
        email: "owner@example.com",
        notificationEmail: null,
        onboardingVersion: 2,
      }],
      [{
        completionEmailStatus: "enabled",
        marketingEmailStatus: "declined",
      }],
      [],
    );
    mocks.getDb.mockReturnValue(db);

    const response = await POST(new Request(
      "http://localhost/api/account/completion-email-preference",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "enabled",
          marketingStatus: "declined",
        }),
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      available: true,
      status: "enabled",
      marketingStatus: "declined",
      promptDue: false,
    });
  });
});
