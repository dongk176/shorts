import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/billing", () => ({ getBillingSummary: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: vi.fn() }));
import { accountConfig } from "./runtime";
import { TokenVault } from "./crypto";
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("YOUTUBE_ACCOUNTS_MODE", "local"); vi.stubEnv("YOUTUBE_ACCOUNTS_ORIGIN", "http://localhost:3001");
  vi.stubEnv("DATABASE_URL", "postgres://test:test@127.0.0.1:5432/test");
  vi.stubEnv("YOUTUBE_ACCOUNTS_ALLOWED_USER_IDS", "11111111-1111-4111-8111-111111111111");
  vi.stubEnv("YOUTUBE_ACCOUNTS_CLIENT_ID", "test"); vi.stubEnv("YOUTUBE_ACCOUNTS_CLIENT_SECRET", "test");
  vi.stubEnv("YOUTUBE_ACCOUNTS_ALLOW_NON_PRIVATE_UPLOADS", "");
});
afterEach(() => vi.unstubAllEnvs());
it("nonprivate uploads require an explicit server flag and retain the local-only boundary",()=>{
  expect(accountConfig().allowNonPrivateUploads).toBe(false);
  vi.stubEnv("YOUTUBE_ACCOUNTS_ALLOW_NON_PRIVATE_UPLOADS","1");expect(accountConfig().allowNonPrivateUploads).toBe(false);
  vi.stubEnv("YOUTUBE_ACCOUNTS_ALLOW_NON_PRIVATE_UPLOADS","true");expect(accountConfig().allowNonPrivateUploads).toBe(true);
  vi.stubEnv("VERCEL_ENV","preview");expect(()=>accountConfig()).toThrow();
});
it("only permits explicitly configured local candidate and allowed app users", () => {
  expect(accountConfig().redirectUri).toBe("http://localhost:3000/api/youtube/oauth/callback");
  vi.stubEnv("YOUTUBE_ACCOUNTS_MODE", "off");expect(() => accountConfig()).toThrow();
  vi.stubEnv("YOUTUBE_ACCOUNTS_MODE", "local");vi.stubEnv("NODE_ENV", "production");expect(() => accountConfig()).toThrow();
  vi.stubEnv("NODE_ENV", "development");vi.stubEnv("DATABASE_URL", "postgres://user:pass@production.example/db");expect(() => accountConfig()).toThrow();
});
it("rejects missing allowlist and exposes no permissive fallback", () => {
  vi.stubEnv("YOUTUBE_ACCOUNTS_ALLOWED_USER_IDS", "");expect(() => accountConfig()).toThrow();
});
it("can read old encrypted records after a key rotation and rejects tampering", () => {
  const oldKey = Buffer.alloc(32, 1), newKey = Buffer.alloc(32, 2);
  const old = new TokenVault({ old: oldKey }, "old").seal("secret", "user", "channel");
  const rotated = new TokenVault({ old: oldKey, new: newKey }, "new");
  expect(rotated.open(old, "user", "channel")).toBe("secret");
  expect(rotated.seal("secret", "user", "channel")).toMatch(/^v1\.new\./);
  expect(() => rotated.open(old.slice(0, -3) + "xxx", "user", "channel")).toThrow();
});

it("general availability keeps paid upload entitlement while allowing channel management", async () => {
  const { getDb } = await import("@/lib/db");
  const { getBillingSummary } = await import("@/lib/billing");
  const { accountServices } = await import("./runtime");
  const { REVIEW_CLIENT_ID } = await import("./review-access");
  const userId="33333333-3333-4333-8333-333333333333", shortId="44444444-4444-4444-8444-444444444444";
  vi.stubEnv("YOUTUBE_ACCOUNTS_MODE","review");vi.stubEnv("VERCEL_ENV","production");
  vi.stubEnv("VERCEL_PROJECT_ID","prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw");
  vi.stubEnv("DATABASE_URL","postgres://postgres.mvcprswvfybudtopepuj:test@aws-1-ap-northeast-2.pooler.supabase.com/postgres");
  vi.stubEnv("YOUTUBE_ACCOUNTS_CLIENT_ID",REVIEW_CLIENT_ID);
  vi.stubEnv("YOUTUBE_ACCOUNTS_KEYRING",JSON.stringify({v1:Buffer.alloc(32,7).toString("base64")}));vi.stubEnv("YOUTUBE_ACCOUNTS_ACTIVE_KEY","v1");
  vi.stubEnv("YOUTUBE_ADMIN_REVIEW_ENABLED","true");
  vi.stubEnv("YOUTUBE_REVIEWER_ACCESS",JSON.stringify({userId:"11111111-1111-4111-8111-111111111111",shortId,expiresAt:"2026-10-20T00:00:00Z"}));
  const db=vi.fn(async (q:TemplateStringsArray)=>{
    const sql=q.join("?");
    if(sql.includes("is_admin=true"))return [];
    if(sql.includes("select id from shorts_mvp.app_users"))return [{id:userId}];
    if(sql.includes("from shorts_mvp.generated_shorts"))return [{id:shortId,projectNumber:1,outputS3Key:"outputs/test.mp4",renderVersion:1}];
    return [];
  });
  vi.mocked(getDb).mockReturnValue(db as never);
  vi.mocked(getBillingSummary).mockResolvedValue({activeProducts:[]} as never);
  const {service}=accountServices(),actor={userId,sessionId:"test-session"};
  await expect(service.list(actor)).resolves.toEqual([]);
  await expect(service.list(actor,shortId)).rejects.toMatchObject({status:402});
  vi.mocked(getBillingSummary).mockResolvedValue({activeProducts:[{id:"paid"}]} as never);
  await expect(service.list(actor,shortId)).resolves.toEqual([]);
});
