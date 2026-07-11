import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

describe("MVP session cookie", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
  });

  it("stores only a SHA-256 hash and issues a secure HttpOnly cookie", async () => {
    const set = vi.fn();
    mocks.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined), set });
    let storedHash = "";
    const db = vi.fn((_strings: TemplateStringsArray, value: string) => {
      storedHash = value;
      return Promise.resolve([{ id: "session-new", selectedPlanCode: "plus" }]);
    });
    mocks.getDb.mockReturnValue(db);

    const { requireMvpSession } = await import("./session");
    await expect(requireMvpSession()).resolves.toEqual({
      id: "session-new",
      selectedPlanCode: "plus",
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
});
