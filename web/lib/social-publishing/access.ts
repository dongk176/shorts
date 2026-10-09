import "server-only";
import type { Sql } from "postgres";
import { HttpError } from "@/lib/http";
import { metaReviewerGrant } from "./meta/reviewer-access";

// The rollout grants publishing, never site administration, to the client UI.
// Every API independently rechecks this server-side role from the database.
export async function canUseAdminPublishing(db: Sql, userId: string) {
  if (process.env.TIKTOK_PUBLISHING_MODE !== "admin-review" && process.env.TIKTOK_PUBLISHING_MODE !== "public" && process.env.META_PUBLISHING_MODE !== "admin-review") return false;
  const rows = await db`select id from shorts_mvp.app_users where id=${userId} and is_admin=true and withdrawn_at is null limit 1`;
  return rows.length === 1;
}

export async function requireAdminPublishing(db: Sql, userId: string) {
  if (process.env.TIKTOK_PUBLISHING_MODE !== "admin-review" || !await canUseAdminPublishing(db, userId)) throw new HttpError(403, "Publishing is not available for this account.", "TIKTOK_DISABLED");
}

export async function requireMetaAdminPublishing(db: Sql, userId: string) {
  const denied = () => new HttpError(403, "Publishing is not available for this account.", "META_DISABLED");
  if (process.env.META_PUBLISHING_MODE !== "admin-review") throw denied();
  const grant = metaReviewerGrant();
  const rows = await db`select id from shorts_mvp.app_users where id=${userId} and withdrawn_at is null
    and (is_admin=true or (id=${grant?.userId ?? null} and clock_timestamp()<${grant?.expiresAt ?? null}::timestamptz)) limit 1`;
  if (!rows.length) throw denied();
}

export async function metaReviewerShortForProject(db: Sql, userId: string, projectNumber: number) {
  const grant = metaReviewerGrant();
  if (!grant || grant.userId !== userId) return null;
  const rows = await db`select s.id from shorts_mvp.generated_shorts s
    join shorts_mvp.video_jobs j on j.id=s.job_id join shorts_mvp.app_users u on u.id=s.user_id
    where s.id=${grant.shortId} and s.user_id=${userId} and j.user_id=${userId} and j.project_number=${projectNumber}
      and u.withdrawn_at is null and j.is_example=false and j.status<>'deleted' and j.user_deleted_at is null
      and s.status='ready' and s.deleted_at is null and s.output_s3_key is not null
      and (s.expires_at is null or s.expires_at>now()) and clock_timestamp()<${grant.expiresAt}::timestamptz limit 1`;
  return rows.length ? grant.shortId : null;
}
