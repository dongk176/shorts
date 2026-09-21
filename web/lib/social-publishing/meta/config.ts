import { HttpError } from "@/lib/http";
import { platformSchema, type MetaPlatform } from "./contracts";

export function metaConfig(platform: MetaPlatform, env: NodeJS.ProcessEnv = process.env) {
  platformSchema.parse(platform);
  if (env.META_PUBLISHING_MODE !== "admin-review") throw new HttpError(404, "Publishing is disabled.", "META_DISABLED");
  let database: URL;
  try { database = new URL(env.DATABASE_URL || ""); } catch { throw new HttpError(503, "Publishing setup is incomplete.", "META_SETUP_REQUIRED"); }
  if (!["postgres:", "postgresql:"].includes(database.protocol) || database.hostname !== "aws-1-ap-northeast-2.pooler.supabase.com" || database.username !== "postgres.mvcprswvfybudtopepuj"
    || env.VERCEL_PROJECT_ID !== "prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw" || env.VERCEL_ENV !== "production") {
    throw new HttpError(503, "Publishing environment is not allowed.", "META_SETUP_REQUIRED");
  }
  const clientId = env[`${platform.toUpperCase()}_APP_ID`] || "";
  const clientSecret = env[`${platform.toUpperCase()}_APP_SECRET`] || "";
  const graphVersion = env.META_GRAPH_VERSION || "";
  const origin = "https://www.easycut.co.kr";
  return {
    platform, clientId, clientSecret, graphVersion, origin, appKey: `${platform}:${clientId}`,
    redirectUri: `${origin}/api/social/${platform}/oauth/callback`,
    scopes: platform === "instagram" ? ["instagram_business_basic", "instagram_business_content_publish"] : ["threads_basic", "threads_content_publish"],
    oauthReady: /^\d+$/.test(clientId) && Boolean(clientSecret) && (platform === "threads" || /^v\d+\.0$/.test(graphVersion)),
  };
}
export type MetaConfig = ReturnType<typeof metaConfig>;
