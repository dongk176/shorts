import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getDb: vi.fn(),
  getAuthenticatedUser: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));

describe("MVP session cookie", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    mocks.getAuthenticatedUser.mockResolvedValue(null);
  });

  it("stores only a SHA-256 hash and issues a secure HttpOnly cookie", async () => {
    const set = vi.fn();
    mocks.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined), set });
    let storedHash = "";
    const db = vi.fn((_strings: TemplateStringsArray, value: string) => {
      storedHash = value;
      return Promise.resolve([{ id: "session-new", selectedPlanCode: "plus", userId: null }]);
    });
    mocks.getDb.mockReturnValue(db);

    const { requireMvpSession } = await import("./session");
    await expect(requireMvpSession()).resolves.toEqual({
      id: "session-new",
      selectedPlanCode: "plus",
      userId: null,
      user: null,
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

  it("saves the Google profile and claims the current anonymous session", async () => {
    const set = vi.fn();
    mocks.cookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "anonymous-token" }),
      set,
    });
    mocks.getAuthenticatedUser.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      email: "creator@example.com",
      app_metadata: { provider: "google" },
      user_metadata: { full_name: "Creator", avatar_url: "https://example.com/avatar.png" },
      last_sign_in_at: "2026-07-13T17:00:00.000Z",
    });
    const transaction = vi.fn().mockResolvedValue([]);
    const db = vi.fn()
      .mockResolvedValueOnce([{ id: "session-anonymous", selectedPlanCode: "standard", userId: null, lastSeenAt: new Date() }])
      .mockResolvedValueOnce([{ id: "app-user", selectedPlanCode: "standard" }]);
    Object.assign(db, { begin: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)) });
    mocks.getDb.mockReturnValue(db);

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
        displayName: "Creator",
        avatarUrl: "https://example.com/avatar.png",
      },
    });
    expect(transaction).toHaveBeenCalledTimes(6);
    expect(set).not.toHaveBeenCalled();
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
});
