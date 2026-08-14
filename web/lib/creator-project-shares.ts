import { createHash, randomBytes } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { getDb } from "@/lib/db";

export const CREATOR_PROJECT_SHARE_DAYS = 7;
export const CREATOR_PROJECT_SHARE_ATTRIBUTION_DAYS = 7;

export type CreatorProjectShareStatus = "active" | "expired" | "revoked" | "unavailable";

export type CreatorProjectShareShort = {
  id: string;
  hookTitle: string;
  highlightReason: string;
  durationSeconds: number;
  renderVersion: number;
};

export type CreatorProjectShareView = {
  id: string;
  recipientName: string;
  projectNumber: number;
  videoTitle: string;
  channelName: string;
  channelThumbnailUrl: string | null;
  thumbnailUrl: string;
  issuedAt: string;
  expiresAt: string;
  status: CreatorProjectShareStatus;
  shorts: CreatorProjectShareShort[];
};

export type AdminCreatorProjectShare = {
  id: string;
  projectNumber: number;
  videoTitle: string;
  recipientName: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  status: CreatorProjectShareStatus;
  totalViews: number;
  uniqueVisitors: number;
  totalCtaClicks: number;
  uniqueCtaVisitors: number;
  signupConversions: number;
};

type Db = Sql | TransactionSql;

export function createCreatorProjectShareToken() {
  return randomBytes(32).toString("base64url");
}

export function creatorProjectShareTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isCreatorProjectShareToken(value: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function iso(value: unknown) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
}

function shareStatus(row: {
  revokedAt?: Date | string | null;
  expiresAt: Date | string;
  jobStatus?: string;
  isExample?: boolean;
}, now = Date.now()): CreatorProjectShareStatus {
  if (row.revokedAt) return "revoked";
  if (new Date(row.expiresAt).getTime() <= now) return "expired";
  if (row.jobStatus !== undefined && (row.jobStatus !== "completed" || row.isExample)) {
    return "unavailable";
  }
  return "active";
}

export async function loadCreatorProjectShare(
  token: string,
): Promise<CreatorProjectShareView | null> {
  if (!isCreatorProjectShareToken(token)) return null;
  const db = getDb();
  const rows = await db`
    select share.id,share.recipient_name,share.issued_at,share.expires_at,
      share.revoked_at,job.id as job_id,job.project_number,job.video_title,
      job.channel_name,job.channel_thumbnail_url,job.thumbnail_url,
      job.status as job_status,job.is_example
    from shorts_mvp.creator_project_shares share
    join shorts_mvp.video_jobs job on job.id=share.job_id
    where share.token_hash=${creatorProjectShareTokenHash(token)}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;

  let status = shareStatus({
    revokedAt: row.revokedAt as Date | null,
    expiresAt: row.expiresAt as Date,
    jobStatus: String(row.jobStatus),
    isExample: Boolean(row.isExample),
  });
  let shorts: CreatorProjectShareShort[] = [];
  if (status === "active") {
    const shortRows = await db`
      select id,hook_title,highlight_reason,duration_seconds,render_version
      from shorts_mvp.generated_shorts
      where job_id=${row.jobId}
        and status in ('ready','rerendering')
        and deleted_at is null
        and expires_at>clock_timestamp()
      order by clip_index
    `;
    shorts = shortRows.map((short) => ({
      id: String(short.id),
      hookTitle: String(short.hookTitle || ""),
      highlightReason: String(short.highlightReason || ""),
      durationSeconds: Number(short.durationSeconds || 0),
      renderVersion: Number(short.renderVersion || 1),
    }));
    if (shorts.length === 0) status = "unavailable";
  }

  return {
    id: String(row.id),
    recipientName: String(row.recipientName),
    projectNumber: Number(row.projectNumber),
    videoTitle: String(row.videoTitle),
    channelName: String(row.channelName),
    channelThumbnailUrl: row.channelThumbnailUrl
      ? String(row.channelThumbnailUrl)
      : null,
    thumbnailUrl: String(row.thumbnailUrl),
    issuedAt: iso(row.issuedAt),
    expiresAt: iso(row.expiresAt),
    status,
    shorts,
  };
}

async function findActiveShare(db: Db, token: string) {
  if (!isCreatorProjectShareToken(token)) return null;
  const rows = await db`
    select share.id,share.job_id
    from shorts_mvp.creator_project_shares share
    join shorts_mvp.video_jobs job on job.id=share.job_id
    where share.token_hash=${creatorProjectShareTokenHash(token)}
      and share.revoked_at is null
      and share.expires_at>clock_timestamp()
      and job.status='completed'
      and job.is_example=false
      and exists (
        select 1 from shorts_mvp.generated_shorts short
        where short.job_id=job.id
          and short.status in ('ready','rerendering')
          and short.deleted_at is null
          and short.expires_at>clock_timestamp()
      )
    limit 1
  `;
  return rows[0] || null;
}

export async function recordCreatorProjectShareVisit({
  db,
  token,
  sessionId,
  requestId,
}: {
  db: Db;
  token: string;
  sessionId: string;
  requestId: string;
}) {
  const share = await findActiveShare(db, token);
  if (!share) return false;
  await db`
    insert into shorts_mvp.creator_project_share_visitors (
      share_id,mvp_session_id,last_view_request_id
    ) values (${share.id},${sessionId},${requestId})
    on conflict (share_id,mvp_session_id) do update
    set view_count=case
          when creator_project_share_visitors.last_view_request_id
            <> excluded.last_view_request_id
          then creator_project_share_visitors.view_count+1
          else creator_project_share_visitors.view_count
        end,
        last_viewed_at=case
          when creator_project_share_visitors.last_view_request_id
            <> excluded.last_view_request_id
          then clock_timestamp()
          else creator_project_share_visitors.last_viewed_at
        end,
        last_view_request_id=excluded.last_view_request_id
  `;
  return true;
}

export async function recordCreatorProjectShareCta({
  db,
  token,
  sessionId,
  viewRequestId,
  ctaRequestId,
}: {
  db: Db;
  token: string;
  sessionId: string;
  viewRequestId: string;
  ctaRequestId: string;
}) {
  const share = await findActiveShare(db, token);
  if (!share) return false;
  await db`
    insert into shorts_mvp.creator_project_share_visitors (
      share_id,mvp_session_id,last_view_request_id,
      first_cta_clicked_at,last_cta_clicked_at,cta_click_count,last_cta_request_id
    ) values (
      ${share.id},${sessionId},${viewRequestId},
      clock_timestamp(),clock_timestamp(),1,${ctaRequestId}
    )
    on conflict (share_id,mvp_session_id) do update
    set first_cta_clicked_at=coalesce(
          creator_project_share_visitors.first_cta_clicked_at,
          clock_timestamp()
        ),
        last_cta_clicked_at=case
          when creator_project_share_visitors.last_cta_request_id
            is distinct from excluded.last_cta_request_id
          then clock_timestamp()
          else creator_project_share_visitors.last_cta_clicked_at
        end,
        cta_click_count=case
          when creator_project_share_visitors.last_cta_request_id
            is distinct from excluded.last_cta_request_id
          then creator_project_share_visitors.cta_click_count+1
          else creator_project_share_visitors.cta_click_count
        end,
        last_cta_request_id=excluded.last_cta_request_id
  `;
  return true;
}

export async function loadAdminCreatorProjectShares(
  adminUserId: string,
): Promise<AdminCreatorProjectShare[]> {
  const rows = await getDb()`
    select share.id,share.recipient_name,share.issued_at,share.expires_at,
      share.revoked_at,job.project_number,job.video_title,job.status as job_status,
      job.is_example,
      coalesce(metrics.total_views,0)::integer as total_views,
      coalesce(metrics.unique_visitors,0)::integer as unique_visitors,
      coalesce(metrics.total_cta_clicks,0)::integer as total_cta_clicks,
      coalesce(metrics.unique_cta_visitors,0)::integer as unique_cta_visitors,
      coalesce(metrics.signup_conversions,0)::integer as signup_conversions
    from shorts_mvp.creator_project_shares share
    join shorts_mvp.video_jobs job on job.id=share.job_id
    left join lateral (
      select
        coalesce(sum(visitor.view_count),0)::integer as total_views,
        count(*)::integer as unique_visitors,
        coalesce(sum(visitor.cta_click_count),0)::integer as total_cta_clicks,
        count(*) filter (where visitor.cta_click_count>0)::integer
          as unique_cta_visitors,
        count(*) filter (where visitor.converted_at is not null)::integer
          as signup_conversions
      from shorts_mvp.creator_project_share_visitors visitor
      where visitor.share_id=share.id
    ) metrics on true
    where share.created_by_user_id=${adminUserId}
    order by share.issued_at desc
    limit 200
  `;
  return rows.map((row) => ({
    id: String(row.id),
    projectNumber: Number(row.projectNumber),
    videoTitle: String(row.videoTitle),
    recipientName: String(row.recipientName),
    issuedAt: iso(row.issuedAt),
    expiresAt: iso(row.expiresAt),
    revokedAt: row.revokedAt ? iso(row.revokedAt) : null,
    status: shareStatus({
      revokedAt: row.revokedAt as Date | null,
      expiresAt: row.expiresAt as Date,
      jobStatus: String(row.jobStatus),
      isExample: Boolean(row.isExample),
    }),
    totalViews: Number(row.totalViews || 0),
    uniqueVisitors: Number(row.uniqueVisitors || 0),
    totalCtaClicks: Number(row.totalCtaClicks || 0),
    uniqueCtaVisitors: Number(row.uniqueCtaVisitors || 0),
    signupConversions: Number(row.signupConversions || 0),
  }));
}

export async function findCreatorShareMedia(
  token: string,
  shortId: string,
) {
  if (!isCreatorProjectShareToken(token)) return null;
  const rows = await getDb()`
    select short.output_s3_key,short.thumbnail_s3_key,short.expires_at,
      short.render_version,share.expires_at as share_expires_at
    from shorts_mvp.creator_project_shares share
    join shorts_mvp.video_jobs job on job.id=share.job_id
    join shorts_mvp.generated_shorts short on short.job_id=job.id
    where share.token_hash=${creatorProjectShareTokenHash(token)}
      and share.revoked_at is null
      and share.expires_at>clock_timestamp()
      and job.status='completed'
      and job.is_example=false
      and short.id=${shortId}
      and short.status in ('ready','rerendering')
      and short.deleted_at is null
      and short.expires_at>clock_timestamp()
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    outputKey: String(row.outputS3Key),
    thumbnailKey: row.thumbnailS3Key ? String(row.thumbnailS3Key) : null,
    mediaExpiresAt: row.expiresAt as Date,
    shareExpiresAt: row.shareExpiresAt as Date,
    renderVersion: Number(row.renderVersion || 1),
  };
}
