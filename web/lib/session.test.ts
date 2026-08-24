import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getDb: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  issueLoginWelcomeGrantIfEligible: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/onboarding-welcome-grant", () => ({
  issueLoginWelcomeGrantIfEligible: mocks.issueLoginWelcomeGrantIfEligible,
}));

describe("MVP session cookie", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    mocks.issueLoginWelcomeGrantIfEligible.mockResolvedValue(false);
  });

  it("stores only a SHA-256 hash and issues a secure HttpOnly cookie", async () => {
    const set = vi.fn();
    mocks.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined), set });
    let storedHash = "";
    const db = vi.fn((_strings: TemplateStringsArray, value: string) => {
      storedHash = value;
      return Promise.resolve([{ id: "session-new", selectedPlanCode: "free", userId: null }]);
    });
    mocks.getDb.mockReturnValue(db);

    const { requireMvpSession } = await import("./session");
    await expect(requireMvpSession()).resolves.toEqual({
      id: "session-new",
      selectedPlanCode: "free",
      userId: null,
      user: null,
      isAdmin: false,
    });

    expect(storedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(set).toHaveBeenCalledOnce();
    const [name, rawToken, options] = set.mock.calls[0];
    expect(name).toBe("shorts_mvp_session");
    expect(rawToken).not.toBe(storedHash);
    expect(rawToken.length).toBeGreaterThanOrEqual(40);
    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  });

  it("does not create or set a session while rendering a signed-out server page", async () => {
    const set = vi.fn();
    mocks.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined), set });
    const db = vi.fn();
    mocks.getDb.mockReturnValue(db);

    const { requireMvpSession } = await import("./session");
    await expect(requireMvpSession(undefined, {
      createIfMissing: false,
    })).resolves.toEqual({
      id: "",
      selectedPlanCode: "free",
      userId: null,
      user: null,
      isAdmin: false,
    });

    expect(db).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("returns authenticated page state without mutating cookies when the MVP cookie is missing", async () => {
    const set = vi.fn();
    mocks.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined), set });
    mocks.getAuthenticatedUser.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      email: "creator@example.com",
      app_metadata: { provider: "google" },
      user_metadata: {},
    });
    const db = vi.fn().mockResolvedValueOnce([{
      id: "app-user",
      isAdmin: true,
      selectedPlanCode: "standard",
    }]);
    mocks.getDb.mockReturnValue(db);

    const { requireMvpSession } = await import("./session");
    await expect(requireMvpSession(undefined, {
      createIfMissing: false,
    })).resolves.toMatchObject({
      id: "",
      userId: "app-user",
      selectedPlanCode: "standard",
      isAdmin: true,
    });

    expect(db).toHaveBeenCalledOnce();
    expect(set).not.toHaveBeenCalled();
  });

  it("rejects a signed-out authenticated read before touching the MVP cookie store", async () => {
    const { requireAuthenticatedMvpSession } = await import("./session");

    await expect(requireAuthenticatedMvpSession({
      createIfMissing: false,
    })).rejects.toMatchObject({
      status: 401,
    });
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("saves the Google profile and claims the current anonymous session", async () => {
    const set = vi.fn();
    const deleteCookie = vi.fn();
    mocks.cookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "anonymous-token" }),
      set,
      delete: deleteCookie,
    });
    mocks.getAuthenticatedUser.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      email: "creator@example.com",
      app_metadata: { provider: "google" },
      user_metadata: { full_name: "Creator", avatar_url: "https://example.com/avatar.png" },
      last_sign_in_at: "2026-07-13T17:00:00.000Z",
    });
    const transaction = vi.fn()
      .mockResolvedValueOnce([{ id: "app-user", selectedPlanCode: "free" }])
      .mockResolvedValueOnce([{ selectedPlanCode: "standard" }])
      .mockResolvedValue([]);
    const db = vi.fn()
      .mockResolvedValueOnce([{ id: "session-anonymous", selectedPlanCode: "standard", userId: null, lastSeenAt: new Date() }]);
    Object.assign(db, { begin: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)) });
    mocks.getDb.mockReturnValue(db);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.issueLoginWelcomeGrantIfEligible.mockRejectedValueOnce(
      new Error("temporary grant failure"),
    );

    const { claimMvpSession } = await import("./session");
    await expect(claimMvpSession({
      id: "11111111-1111-4111-8111-111111111111",
      email: "creator@example.com",
      app_metadata: { provider: "google" },
      user_metadata: { full_name: "Creator", avatar_url: "https://example.com/avatar.png" },
      last_sign_in_at: "2026-07-13T17:00:00.000Z",
    } as never)).resolves.toEqual({
      id: "session-anonymous",
      selectedPlanCode: "standard",
      userId: "app-user",
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "creator@example.com",
        loginId: null,
        displayName: "Creator",
        avatarUrl: "https://example.com/avatar.png",
      },
    });
    expect(transaction).toHaveBeenCalledTimes(9);
    expect(transaction.mock.calls.some(([strings]) => (
      Array.from(strings as TemplateStringsArray).join("?")
        .includes("creator_project_share_visitors")
    ))).toBe(true);
    expect(mocks.issueLoginWelcomeGrantIfEligible)
      .toHaveBeenCalledWith(db, "app-user");
    expect(errorSpy).toHaveBeenCalledWith("login_welcome_grant_failed", {
      errorName: "Error",
    });
    expect(set).not.toHaveBeenCalled();
    expect(deleteCookie).toHaveBeenCalledWith("easycut_referral");
    errorSpy.mockRestore();
  });

  it("reads an authenticated session without claiming resources again", async () => {
    const set = vi.fn();
    mocks.cookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "authenticated-token" }),
      set,
    });
    mocks.getAuthenticatedUser.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      email: "creator@example.com",
      app_metadata: { provider: "google" },
      user_metadata: {},
    });
    const db = vi.fn()
      .mockResolvedValueOnce([{
        id: "session-authenticated",
        selectedPlanCode: "standard",
        userId: "app-user",
        lastSeenAt: new Date(),
      }])
      .mockResolvedValueOnce([{ id: "app-user", selectedPlanCode: "standard" }]);
    const begin = vi.fn();
    Object.assign(db, { begin });
    mocks.getDb.mockReturnValue(db);

    const { requireMvpSession } = await import("./session");
    await expect(requireMvpSession()).resolves.toMatchObject({
      id: "session-authenticated",
      userId: "app-user",
      selectedPlanCode: "standard",
    });
    expect(db).toHaveBeenCalledTimes(2);
    expect(begin).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("does not count an existing application user as a creator-project signup", async () => {
    mocks.cookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "anonymous-token" }),
      set: vi.fn(),
      delete: vi.fn(),
    });
    const transaction = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "app-user", selectedPlanCode: "free" }])
      .mockResolvedValueOnce([{ selectedPlanCode: "free" }])
      .mockResolvedValue([]);
    const db = vi.fn().mockResolvedValueOnce([{
      id: "anonymous-session",
      selectedPlanCode: "free",
      userId: null,
      lastSeenAt: new Date(),
    }]);
    Object.assign(db, {
      begin: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    });
    mocks.getDb.mockReturnValue(db);

    const { claimMvpSession } = await import("./session");
    await claimMvpSession({
      id: "11111111-1111-4111-8111-111111111111",
      email: "existing@example.com",
      app_metadata: { provider: "google" },
      user_metadata: {},
      last_sign_in_at: "2026-08-14T01:00:00.000Z",
    } as never);

    expect(transaction).toHaveBeenCalledTimes(9);
    expect(transaction.mock.calls.some(([strings]) => (
      Array.from(strings as TemplateStringsArray).join("?")
        .includes("creator_project_share_visitors")
    ))).toBe(false);
  });

  it("attributes a valid first-click only when the application user is newly created", async () => {
    const deleteCookie = vi.fn();
    mocks.cookies.mockResolvedValue({
      get: vi.fn((name: string) => (
        name === "shorts_mvp_session"
          ? { value: "anonymous-token" }
          : name === "easycut_referral" ? { value: "referral-token" } : undefined
      )),
      set: vi.fn(),
      delete: deleteCookie,
    });
    const transaction = vi.fn()
      .mockResolvedValueOnce([{ id: "app-user", selectedPlanCode: "free" }])
      .mockResolvedValueOnce([{ id: "visitor-1", partnerId: "partner-1" }])
      .mockResolvedValueOnce([{ id: "app-user" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ selectedPlanCode: "free" }])
      .mockResolvedValue([]);
    const db = vi.fn()
      .mockResolvedValueOnce([{
        id: "anonymous-session",
        selectedPlanCode: "free",
        userId: null,
        lastSeenAt: new Date(),
      }]);
    Object.assign(db, {
      begin: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    });
    mocks.getDb.mockReturnValue(db);

    const { claimMvpSession } = await import("./session");
    await claimMvpSession({
      id: "11111111-1111-4111-8111-111111111111",
      email: "new@example.com",
      created_at: "2026-07-28T01:00:00.000Z",
      app_metadata: { provider: "google" },
      user_metadata: {},
      last_sign_in_at: "2026-07-28T01:00:00.000Z",
    } as never);

    expect(transaction).toHaveBeenCalledTimes(12);
    const conversionSql = transaction.mock.calls
      .map(([strings]) => Array.from(strings as TemplateStringsArray).join("?"))
      .find((statement) => statement.includes("creator_project_share_visitors"));
    expect(conversionSql).toContain("visitor.mvp_session_id=?");
    expect(conversionSql).toContain("visitor.last_cta_clicked_at >= clock_timestamp()");
    expect(conversionSql).toContain("order by visitor.last_cta_clicked_at desc");
    expect(conversionSql).toContain("limit 1");
    expect(mocks.issueLoginWelcomeGrantIfEligible)
      .toHaveBeenCalledWith(db, "app-user");
    expect(deleteCookie).toHaveBeenCalledWith("easycut_referral");
  });
});
