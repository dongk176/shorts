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

describe("marketing email preference API", () => {
  it("prompts only after an onboarding v2 account completes a project", async () => {
    mocks.getDb.mockReturnValue(sqlWithRows([{
      email: "owner@example.com",
      marketingEmail: null,
      marketingEmailStatus: null,
      onboardingVersion: 2,
      completedJobCount: 1,
    }]));

    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({
      available: true,
      eligible: true,
      status: "not_asked",
      email: "owner@example.com",
      promptDue: true,
      completedJobCount: 1,
    });
  });

  it("does not prompt before completion or for legacy onboarding", async () => {
    mocks.getDb
      .mockReturnValueOnce(sqlWithRows([{
        email: "owner@example.com",
        onboardingVersion: 2,
        completedJobCount: 0,
      }]))
      .mockReturnValueOnce(sqlWithRows([{
        email: "owner@example.com",
        onboardingVersion: 1,
        completedJobCount: 10,
      }]));

    await expect((await GET()).json()).resolves.toMatchObject({
      eligible: true,
      promptDue: false,
    });
    await expect((await GET()).json()).resolves.toMatchObject({
      eligible: false,
      promptDue: false,
    });
  });

  it("stores an explicit advertising choice without changing completion mail", async () => {
    const db = mutationDb(
      [{
        email: "owner@example.com",
        marketingEmail: null,
        onboardingVersion: 2,
      }],
      [{ marketingEmailStatus: "enabled" }],
      [],
    );
    mocks.getDb.mockReturnValue(db);

    const response = await POST(new Request(
      "http://localhost/api/account/marketing-email-preference",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "enabled",
          email: "Promos@Example.com",
        }),
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "enabled",
      email: "promos@example.com",
      promptDue: false,
    });
    const mutationSource = db.sql.mock.calls
      .map((call) => String(call[0].join("?")))
      .join("\n");
    expect(mutationSource).not.toContain("job_completion_email_notifications");
    expect(db.sql.mock.calls.flat()).toContain("promos@example.com");
    expect(db.sql.mock.calls.flat()).toContain("2026-08-14-v2");
  });

  it("rejects preference changes when email delivery is unavailable", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;

    const response = await POST(new Request(
      "http://localhost/api/account/marketing-email-preference",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "declined" }),
      },
    ));

    expect(response.status).toBe(503);
  });
});
