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
