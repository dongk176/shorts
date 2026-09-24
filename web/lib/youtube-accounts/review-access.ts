import "server-only";
import { z } from "zod";
import type { Sql } from "postgres";
import { HttpError } from "@/lib/http";
import { uuid } from "./contracts";

const grantSchema = z.object({ userId: uuid, shortId: uuid, expiresAt: z.string().datetime() }).strict();
export const REVIEW_CLIENT_ID = "38531581302-cj7btomfhcunnmgjui80r5nldcbi1g5b.apps.googleusercontent.com";
export function reviewConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.YOUTUBE_ACCOUNTS_MODE !== "review") throw new HttpError(404, "YouTube review is unavailable.");
  const database = new URL(env.DATABASE_URL || "http://invalid");
  if (!["postgres:", "postgresql:"].includes(database.protocol)
    || database.hostname !== "aws-1-ap-northeast-2.pooler.supabase.com"
    || database.username !== "postgres.mvcprswvfybudtopepuj"
    || env.VERCEL_PROJECT_ID !== "prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw" || env.VERCEL_ENV !== "production"
    || env.YOUTUBE_ACCOUNTS_CLIENT_ID !== REVIEW_CLIENT_ID || !env.YOUTUBE_ACCOUNTS_CLIENT_SECRET) {
    throw new HttpError(503, "YouTube review configuration is incomplete.");
  }
  const grant = grantSchema.parse(JSON.parse(env.YOUTUBE_REVIEWER_ACCESS || ""));
  // A second exact owner/clip grant supports the owner’s recorded demo without
  // replacing the reviewer account or enabling publishing for other users.
  const demoGrant = env.YOUTUBE_DEMO_ACCESS
    ? grantSchema.parse(JSON.parse(env.YOUTUBE_DEMO_ACCESS)) : undefined;
  if (demoGrant?.userId === grant.userId) throw new HttpError(503, "YouTube demo grant must have a distinct owner.");
  const grants = demoGrant ? [grant, demoGrant] : [grant];
  const origin = "https://www.easycut.co.kr";
  return { origin, grant, grants, clientId: REVIEW_CLIENT_ID, clientSecret: env.YOUTUBE_ACCOUNTS_CLIENT_SECRET,
    allowedUsers: new Set(grants.map(item => item.userId)), allowNonPrivateUploads: false,
    redirectUri: `${origin}/api/youtube/accounts/oauth/callback`, hosted: true as const };
}
export function assertReviewAccess(userId: string, shortId?: string, allowExpired = false) {
  const grant = reviewConfig().grants.find(item => item.userId === userId);
  if (!grant || (shortId && grant.shortId !== shortId)
    || (!allowExpired && Date.parse(grant.expiresAt) <= Date.now())) throw new HttpError(403, "YouTube review access is unavailable.");
  return grant;
}
export async function youtubeReviewerShortForProject(db: Sql, userId: string, projectNumber: number) {
  try {
    const grant = assertReviewAccess(userId);
    const rows = await db`select s.id from shorts_mvp.generated_shorts s join shorts_mvp.video_jobs j on j.id=s.job_id
      join shorts_mvp.app_users u on u.id=s.user_id
      where s.id=${grant.shortId} and s.user_id=${userId} and j.user_id=${userId} and j.project_number=${projectNumber}
      and u.withdrawn_at is null and j.is_example=false and j.status<>'deleted' and j.user_deleted_at is null
      and s.status='ready' and s.deleted_at is null and s.output_s3_key is not null
      and (s.expires_at is null or s.expires_at>now()) and clock_timestamp()<${grant.expiresAt}::timestamptz limit 1`;
    return rows.length ? grant.shortId : null;
  } catch { return null; }
}
