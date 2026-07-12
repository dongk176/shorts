import type { Sql } from "postgres";
import type { GeneratedShort, Plan, VideoJob } from "@/lib/contracts";

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

export async function getShortsForJobs(db: Sql, jobIds: string[]) {
  if (!jobIds.length) return new Map<string, GeneratedShort[]>();
  const rows = await db`
    select id, job_id, clip_index, start_seconds, end_seconds, duration_seconds,
      hook_title, channel_display_name, subtitle_segments, subtitles_enabled,
      template_id, title_font_scale, render_version, rerender_progress, status, expires_at
    from shorts_mvp.generated_shorts
    where job_id in ${db(jobIds)} and deleted_at is null
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
      channelDisplayName: row.channelDisplayName,
      subtitleSegments: row.subtitleSegments,
      subtitlesEnabled: row.subtitlesEnabled,
      templateId: row.templateId,
      titleFontScale: Number(row.titleFontScale),
      renderVersion: row.renderVersion,
      rerenderProgress: row.rerenderProgress,
      status: row.status,
      expiresAt: row.expiresAt.toISOString(),
    };
    result.set(row.jobId, [...(result.get(row.jobId) || []), item]);
  }
  return result;
}

export async function getRecentJobs(db: Sql, sessionId: string, onlyJobId?: string): Promise<VideoJob[]> {
  const rows = onlyJobId
    ? await db`select * from shorts_mvp.video_jobs where id = ${onlyJobId} and mvp_session_id = ${sessionId}`
    : await db`select * from shorts_mvp.video_jobs where mvp_session_id = ${sessionId} order by created_at desc limit 10`;
  const shorts = await getShortsForJobs(db, rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    videoTitle: row.videoTitle,
    channelName: row.channelName,
    thumbnailUrl: row.thumbnailUrl,
    sourceDurationSeconds: row.sourceDurationSeconds,
    clipLengthOption: row.clipLengthOption,
    outputLanguage: row.outputLanguage,
    expectedShortCount: row.expectedShortCount,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    shorts: shorts.get(row.id) || [],
  })) as VideoJob[];
}
