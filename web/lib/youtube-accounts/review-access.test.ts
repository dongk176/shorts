import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assertReviewAccess, reviewConfig, REVIEW_CLIENT_ID } from "./review-access";
const userId = "11111111-1111-4111-8111-111111111111", shortId = "22222222-2222-4222-8222-222222222222";
const grant = { userId, shortId, expiresAt: "2026-10-20T00:00:00Z" };
const env: NodeJS.ProcessEnv = { NODE_ENV: "production", YOUTUBE_ACCOUNTS_MODE: "review", YOUTUBE_ACCOUNTS_CLIENT_ID: REVIEW_CLIENT_ID, YOUTUBE_ACCOUNTS_CLIENT_SECRET: "test", VERCEL_ENV: "production", VERCEL_PROJECT_ID: "prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw", DATABASE_URL: "postgres://postgres.mvcprswvfybudtopepuj:test@aws-1-ap-northeast-2.pooler.supabase.com/postgres", YOUTUBE_REVIEWER_ACCESS: JSON.stringify(grant) };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-22T00:00:00Z")); Object.entries(env).forEach(([k,v]) => vi.stubEnv(k,v)); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
it("only permits the approved project, DB and OAuth client with one exact grant", () => {
  expect(reviewConfig().redirectUri).toBe("https://www.easycut.co.kr/api/youtube/accounts/oauth/callback");
  expect(reviewConfig().allowNonPrivateUploads).toBe(false);
  vi.stubEnv("YOUTUBE_ACCOUNTS_ALLOW_NON_PRIVATE_UPLOADS","true"); expect(reviewConfig().allowNonPrivateUploads).toBe(false);
  for (const patch of [{VERCEL_ENV:"preview"},{VERCEL_PROJECT_ID:"lab"},{DATABASE_URL:"postgres://test@localhost/db"},{YOUTUBE_ACCOUNTS_CLIENT_ID:"other"},{YOUTUBE_REVIEWER_ACCESS:"{}"},{YOUTUBE_ACCOUNTS_MODE:""}]) expect(() => reviewConfig({...env,...patch})).toThrow();
});
it("expires upload access while permitting the existing reviewer to delete connections", () => {
  expect(() => assertReviewAccess(userId,shortId)).not.toThrow();
  expect(() => assertReviewAccess(shortId,shortId)).toThrow();
  expect(() => assertReviewAccess(userId,userId)).toThrow();
  vi.setSystemTime(new Date(grant.expiresAt));
  expect(() => assertReviewAccess(userId,shortId)).toThrow();
  expect(() => assertReviewAccess(userId,undefined,true)).not.toThrow();
  expect(() => assertReviewAccess(shortId,undefined,true)).toThrow();
});
