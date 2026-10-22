import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ admin: false, signedIn: true, db: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: async () => {
  if (!state.signedIn) { const { HttpError } = await import("@/lib/http"); throw new HttpError(401, "Sign in"); }
  return { userId: "11111111-1111-4111-8111-111111111111", id: "signed-session" };
} }));
import { tiktokConfig } from "./tiktok/config";
import { canUseAdminPublishing } from "./access";
import { connectionDelete, connectionsGet, creatorPost, oauthCallback, oauthStart, postCheck, postsGet, postsPost, previewGet } from "./tiktok/handlers";
const production = {
  NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_PROJECT_ID: "prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw",
  DATABASE_URL: "postgres://postgres.mvcprswvfybudtopepuj:test@aws-1-ap-northeast-2.pooler.supabase.com/postgres",
  TIKTOK_PUBLISHING_MODE: "admin-review", TIKTOK_PUBLIC_ORIGIN: "https://www.easycut.co.kr",
} as const;
beforeEach(() => {
  vi.clearAllMocks(); state.admin = false; state.signedIn = true;
  for (const [key, value] of Object.entries(production)) vi.stubEnv(key, value);
  state.db.mockImplementation(async (strings: TemplateStringsArray) => strings.join("").includes("app_users") && state.admin ? [{ id: "admin", isAdmin: true }] : []);
});
afterEach(() => vi.unstubAllEnvs());
describe("administrator publishing rollout boundary", () => {
  it("requires the exact production project, database and origin; does not enable public posts", () => {
    expect(tiktokConfig(production).auditApproved).toBe(false);
    for (const override of [{ VERCEL_ENV: "preview" }, { VERCEL_PROJECT_ID: "lab" }, { TIKTOK_PUBLIC_ORIGIN: "https://evil.example" }, { DATABASE_URL: "postgres://test@localhost/db" }]) {
      expect(() => tiktokConfig({ ...production, ...override })).toThrow();
    }
  });
  it("does not expose UI availability with the rollout off and rechecks the database role", async () => {
    vi.stubEnv("TIKTOK_PUBLISHING_MODE", ""); state.admin = true;
    expect(await canUseAdminPublishing(state.db as never, "admin")).toBe(false);
    expect(state.db).not.toHaveBeenCalled();
    vi.stubEnv("TIKTOK_PUBLISHING_MODE", "admin-review");
    expect(await canUseAdminPublishing(state.db as never, "admin")).toBe(true);
    state.admin = false;
    expect(await canUseAdminPublishing(state.db as never, "admin")).toBe(false);
  });
  it("rejects ordinary accounts at every authenticated endpoint before reading publishing tables", async () => {
    const req = new Request("https://www.easycut.co.kr/api/social/tiktok", { method: "POST", headers: { Origin: "https://www.easycut.co.kr", "Content-Type": "application/json" }, body: "{}" });
    const calls = [() => connectionsGet(req), () => oauthStart(req), () => creatorPost(req), () => postsGet(req), () => postsPost(req),
      () => connectionDelete(req, { params: Promise.resolve({ connectionId: "arbitrary" }) }),
      () => postCheck(req, { params: Promise.resolve({ postId: "arbitrary" }) }),
      () => previewGet(req, { params: Promise.resolve({ shortId: "arbitrary" }) })];
    for (const call of calls) {
      const res = await call();
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ code: "TIKTOK_DISABLED", requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/) });
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }
    // OAuth must return safely to the product rather than show a raw JSON failure.
    const callback = await oauthCallback(req);
    expect(callback.status).toBe(303);
    const returned = new URL(callback.headers.get("Location")!);
    expect(returned.origin + returned.pathname).toBe("https://www.easycut.co.kr/publish/channels");
    expect(returned.searchParams.get("tiktokAccount")).toBe("failed");
    expect(returned.searchParams.get("tiktokError")).toBe("TIKTOK_DISABLED");
    expect(returned.searchParams.get("tiktokRequest")).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.db.mock.calls.every(([strings]) => strings.join("").includes("app_users"))).toBe(true);
  });
  it("requires authentication even if a caller knows a project or connection ID", async () => {
    state.signedIn = false;
    expect((await connectionsGet(new Request("https://www.easycut.co.kr/api/social/tiktok"))).status).toBe(401);
    expect(state.db).not.toHaveBeenCalled();
  });
});
