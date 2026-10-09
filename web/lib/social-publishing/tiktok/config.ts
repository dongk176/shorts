import { HttpError } from "@/lib/http";
import { proposedCallback } from "../review-contract";
import { uuid } from "./contracts";

export function tiktokConfig(env: NodeJS.ProcessEnv = process.env) {
  const publicEnabled = env.TIKTOK_PUBLISHING_MODE === "public";
  const hosted = publicEnabled || env.TIKTOK_PUBLISHING_MODE === "admin-review";
  if (publicEnabled && env.TIKTOK_DIRECT_POST_AUDIT_APPROVED !== "true") {
    throw new HttpError(503, "TikTok Direct Post approval is required.", "TIKTOK_SETUP_REQUIRED");
  }
  if (!hosted && (env.TIKTOK_PUBLISHING_MODE !== "local" || env.NODE_ENV === "production" || env.VERCEL_ENV)) {
    throw new HttpError(404, "TikTok publishing is not enabled.", "TIKTOK_DISABLED");
  }
  let database: URL;
  try { database = new URL(env.DATABASE_URL || ""); } catch { throw new HttpError(503, "The publishing database is not configured.", "TIKTOK_SETUP_REQUIRED"); }
  const localDatabase = ["localhost", "127.0.0.1", "[::1]"].includes(database.hostname);
  const productionDatabase = database.hostname === "aws-1-ap-northeast-2.pooler.supabase.com" && database.username === "postgres.mvcprswvfybudtopepuj";
  if (!["postgres:", "postgresql:"].includes(database.protocol) || (hosted ? !productionDatabase : !localDatabase)) {
    throw new HttpError(503, "The publishing database identity is not allowed.", "TIKTOK_SETUP_REQUIRED");
  }
  const allowedUsers = new Set((env.TIKTOK_ALLOWED_USER_IDS || "").split(",").filter(Boolean));
  if ((!hosted && !allowedUsers.size) || [...allowedUsers].some(id => !uuid.safeParse(id).success)) throw new HttpError(503, "Review users must be configured.", "TIKTOK_SETUP_REQUIRED");
  const publicOrigin = env.TIKTOK_PUBLIC_ORIGIN || "";
  if (hosted && (env.VERCEL_PROJECT_ID !== "prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw" || env.VERCEL_ENV !== "production" || publicOrigin !== "https://www.easycut.co.kr")) {
    throw new HttpError(503, "The publishing environment is not configured.", "TIKTOK_SETUP_REQUIRED");
  }
  const redirectUri = publicOrigin ? proposedCallback(publicOrigin, "tiktok") : "";
  // An explicit canonical origin prevents Host/forwarded-header injection. Live
  // OAuth must be started and completed on this HTTPS origin (same app session).
  const origin = publicOrigin ? new URL(publicOrigin).origin : "http://localhost:3002";
  const clientKey = env.TIKTOK_CLIENT_KEY || "";
  const clientSecret = env.TIKTOK_CLIENT_SECRET || "";
  // Verified in the Production / Live portal for app 7687459606926346258.
  // A local audit flag must never promote a Sandbox API client to public use.
  if (publicEnabled && clientKey !== "aw0hf13lzubm6qu1") {
    throw new HttpError(503, "The approved production TikTok client is required.", "TIKTOK_SETUP_REQUIRED");
  }
  return {
    hosted, publicEnabled, origin, publicOrigin, redirectUri, clientKey, clientSecret, allowedUsers,
    oauthReady: Boolean(redirectUri && clientKey && clientSecret),
    mediaVerified: env.TIKTOK_MEDIA_ORIGIN_VERIFIED === "true" && Boolean(publicOrigin),
    // Public posting is enabled only in the verified production configuration.
    auditApproved: publicEnabled && env.TIKTOK_DIRECT_POST_AUDIT_APPROVED === "true",
  };
}
export type TikTokConfig = ReturnType<typeof tiktokConfig>;
