import type { Row, Sql } from "postgres";
import type { GeneratedShort, Plan, VideoJob } from "@/lib/contracts";
import type { MvpSession } from "@/lib/session";

export async function getPlans(db: Sql): Promise<Plan[]> {
  const rows = await db`
    select code, display_name, monthly_source_seconds, retention_days
    from shorts_mvp.plans where is_active order by sort_order
  `;
  return rows.map((row) => ({
    code: row.code,
    displayName: row.displayName,
    monthlySourceSeconds: row.monthlySourceSeconds,
    retentionDays: row.retentionDays,
  })) as Plan[];
}

export async function getGeneratedShortCount(db: Sql): Promise<number> {
  const rows = await db`
    select coalesce((
      select value from shorts_mvp.site_metrics where key = 'generated_shorts'
    ), 4321)::bigint as value
  `;
  return Number(rows[0].value);
}

let publicStateCache: {
  expiresAt: number;
  value: Promise<{ plans: Plan[]; generatedShortCount: number }>;
} | null = null;

export async function getPublicMvpState(db: Sql) {
  const now = Date.now();
  if (publicStateCache && publicStateCache.expiresAt > now) return publicStateCache.value;
  const value = Promise.all([getPlans(db), getGeneratedShortCount(db)])
    .then(([plans, generatedShortCount]) => ({ plans, generatedShortCount }));
  publicStateCache = { expiresAt: now + 30_000, value };
  try {
    return await value;
  } catch (error) {
    if (publicStateCache?.value === value) publicStateCache = null;
    throw error;
  }
}

export async function getShortsForJobs(db: Sql, jobIds: string[]) {
  if (!jobIds.length) return new Map<string, GeneratedShort[]>();
  const rows = await db`
    select id, job_id, clip_index, start_seconds, end_seconds, duration_seconds,
      hook_title, highlight_reason, channel_display_name, subtitle_segments, subtitles_enabled,
      template_id, video_aspect_ratio, title_font_scale, render_version,
      rerender_progress, status, expires_at
    from shorts_mvp.generated_shorts
    where job_id in ${db(jobIds)} and deleted_at is null
      and status in ('ready', 'rerendering')
    order by job_id, clip_index
  `;
  const result = new Map<string, GeneratedShort[]>();
  for (const row of rows) {
    const item: GeneratedShort = {
      id: row.id,
      clipIndex: row.clipIndex,
      startSeconds: Number(row.startSeconds),
      endSeconds: Number(row.endSeconds),
      durationSeconds: Number(row.durationSeconds),
      hookTitle: row.hookTitle,
      highlightReason: row.highlightReason || "",
      channelDisplayName: row.channelDisplayName,
      subtitleSegments: row.subtitleSegments,
      subtitlesEnabled: row.subtitlesEnabled,
      templateId: row.templateId,
      videoAspectRatio: row.videoAspectRatio || "1:1",
      titleFontScale: Number(row.titleFontScale),
      renderVersion: row.renderVersion,
      rerenderProgress: row.rerenderProgress,
      status: row.status,
      expiresAt: row.expiresAt?.toISOString() ?? null,
    };
    result.set(row.jobId, [...(result.get(row.jobId) || []), item]);
  }
  return result;
}

export async function getRecentJobs(db: Sql, session: MvpSession, onlyJobId?: string): Promise<VideoJob[]> {
  const rows = onlyJobId
    ? await db`
        select * from shorts_mvp.video_jobs
        where id = ${onlyJobId} and (
          (${session.userId}::uuid is not null and user_id=${session.userId})
          or (${session.userId}::uuid is null and user_id is null and mvp_session_id=${session.id})
          or (is_example and status='completed')
        )
      `
    : await db`
        select * from shorts_mvp.video_jobs
        where ((${session.userId}::uuid is not null and user_id=${session.userId})
          or (${session.userId}::uuid is null and user_id is null and mvp_session_id=${session.id})
          or (is_example and status='completed'))
        order by is_example desc, created_at desc limit 10
      `;
  return mapJobs(db, rows);
}

export async function getPublicExampleJobs(db: Sql): Promise<VideoJob[]> {
  const rows = await db`
    select * from shorts_mvp.video_jobs
    where is_example and status='completed'
    order by created_at desc limit 10
  `;
  return mapJobs(db, rows);
}

async function mapJobs(db: Sql, rows: Row[]): Promise<VideoJob[]> {
  const shorts = await getShortsForJobs(db, rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    isExample: Boolean(row.isExample),
    videoTitle: row.videoTitle,
    channelName: row.channelName,
    channelThumbnailUrl: row.channelThumbnailUrl || null,
    thumbnailUrl: row.thumbnailUrl,
    sourceDurationSeconds: row.sourceDurationSeconds,
    rangeDownloadStatus: row.rangeDownloadStatus || "pending",
    downloadedMediaDurationSeconds:
      row.downloadedMediaDurationSeconds === null ||
      row.downloadedMediaDurationSeconds === undefined
        ? null
        : Number(row.downloadedMediaDurationSeconds),
    downloadedMediaBytes:
      row.downloadedMediaBytes === null || row.downloadedMediaBytes === undefined
        ? null
        : Number(row.downloadedMediaBytes),
    rangeDownloadVerifiedAt: row.rangeDownloadVerifiedAt?.toISOString() ?? null,
    outputLanguage: row.outputLanguage,
    expectedShortCount: row.expectedShortCount,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    shorts: shorts.get(row.id) || [],
  })) as VideoJob[];
}
