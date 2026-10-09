import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ paid: true }));
vi.mock("@/lib/billing", () => ({ getBillingSummary: async () => ({ activeProducts: state.paid ? ["creator"] : [], managedAccountType: null }) }));
import { tiktokConfig } from "./config";
import { canUseTikTokPublishing, requireTikTokAccountAccess, requireTikTokPublishingAccess } from "./access";
const production = {
  NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_PROJECT_ID: "prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw",
  DATABASE_URL: "postgres://postgres.mvcprswvfybudtopepuj:test@aws-1-ap-northeast-2.pooler.supabase.com/postgres",
  TIKTOK_CLIENT_KEY: "aw0hf13lzubm6qu1",
  TIKTOK_PUBLISHING_MODE: "public", TIKTOK_DIRECT_POST_AUDIT_APPROVED: "true", TIKTOK_PUBLIC_ORIGIN: "https://www.easycut.co.kr",
} as const;
beforeEach(() => { state.paid = true; for (const [key, value] of Object.entries(production)) vi.stubEnv(key, value); });
afterEach(() => vi.unstubAllEnvs());
describe("public TikTok release boundaries", () => {
  it("requires approval and exact production identities, leaving local/admin review private", () => {
    expect(tiktokConfig(production)).toMatchObject({ publicEnabled: true, auditApproved: true, hosted: true });
    for (const override of [{ TIKTOK_CLIENT_KEY: "sbawd0xc4kip84qf9e" }, { TIKTOK_CLIENT_KEY: "" }, { TIKTOK_CLIENT_KEY: "other-production-app" }, { TIKTOK_DIRECT_POST_AUDIT_APPROVED: "" }, { VERCEL_ENV: "preview" }, { VERCEL_PROJECT_ID: "prj_OUjrCgwHONBUwrNMASKabA6n5hp0" }, { DATABASE_URL: "postgres://test@localhost/db" }, { TIKTOK_PUBLIC_ORIGIN: "https://easycut-lab.vercel.app" }]) expect(() => tiktokConfig({ ...production, ...override })).toThrow();
    expect(tiktokConfig({ ...production, TIKTOK_PUBLISHING_MODE: "admin-review" }).auditApproved).toBe(false);
  });
  it("allows active paid members to publish but rejects withdrawn and unpaid accounts", async () => {
    const db = vi.fn(async () => [{ isAdmin: false }]);
    const config = tiktokConfig(production);
    expect(await canUseTikTokPublishing(db as never, "member")).toBe(true);
    await expect(requireTikTokPublishingAccess(db as never, "member", config)).resolves.toBeUndefined();
    state.paid = false;
    await expect(requireTikTokPublishingAccess(db as never, "member", config)).rejects.toMatchObject({ status: 402, code: "TIKTOK_PAID_PLAN_REQUIRED" });
    // Account management remains available after a plan expires.
    await expect(requireTikTokAccountAccess(db as never, "member", config)).resolves.toEqual({ isAdmin: false });
    db.mockResolvedValue([]);
    await expect(requireTikTokPublishingAccess(db as never, "withdrawn", config)).rejects.toMatchObject({ status: 403 });
    expect(await canUseTikTokPublishing(db as never, "withdrawn")).toBe(false);
    expect(db.mock.calls.length).toBeGreaterThan(0);
  });
  it("retains administrator review and closes the member UI when rollout is disabled", async () => {
    const db = vi.fn(async () => [{ isAdmin: false }]);
    vi.stubEnv("TIKTOK_PUBLISHING_MODE", "admin-review");
    expect(await canUseTikTokPublishing(db as never, "member")).toBe(false);
    db.mockResolvedValue([{ isAdmin: true }]); state.paid = false;
    await expect(requireTikTokPublishingAccess(db as never, "admin", tiktokConfig())).resolves.toBeUndefined();
    vi.stubEnv("TIKTOK_PUBLISHING_MODE", "");
    expect(await canUseTikTokPublishing(db as never, "admin")).toBe(false);
  });
});
