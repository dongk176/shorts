import type { Row, Sql } from "postgres";
import type { GeneratedShort, Plan, VideoJob } from "@/lib/contracts";
import { editorDocumentSnapshotSchema } from "@/lib/editor-document-contract";
import type { EditorDocumentSnapshot } from "@/lib/editor-document-snapshot";
import { parseCaptionRenderSpec } from "@/lib/caption-render-spec";
import { hasWordTimedTranscription } from "@/lib/transcription-release";
import { userFacingErrorMessage } from "@/lib/public-error";
import type { MvpSession } from "@/lib/session";

export async function getPlans(db: Sql): Promise<Plan[]> {
  const rows = await db`
    select code, display_name, monthly_source_seconds, retention_days,
      monthly_price_krw,yearly_price_krw,max_active_jobs
    from shorts_mvp.plans where is_active order by sort_order
  `;
  return rows.map((row) => ({
    code: row.code,
    displayName: row.displayName,
    monthlySourceSeconds: row.monthlySourceSeconds,
    retentionDays: row.retentionDays,
    monthlyPriceKrw: row.monthlyPriceKrw,
    yearlyPriceKrw: row.yearlyPriceKrw,
    maxActiveJobs: row.maxActiveJobs,
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

export async function getSubtitleTemplateUsage(
  db: Sql,
  userId: string | null,
): Promise<boolean> {
  const rows = await db`
    select exists(
      select 1
      from shorts_mvp.video_jobs
      where user_id=${userId} and subtitle_template_id is not null
    ) as has_used
  `;
  return Boolean(rows[0]?.hasUsed);
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
      selection_raw_start_seconds, selection_raw_end_seconds,
      selection_raw_duration_seconds, selection_candidate_index,
      selection_length_adjustment, selection_repositioned,
      hook_title, highlight_reason, channel_display_name, subtitle_segments, subtitles_enabled,
      comment_overlays, template_id, custom_template_id, template_snapshot, video_aspect_ratio, title_font_scale, title_text_styles,
      subtitle_template_id, caption_render_spec,
      title_text_styles_initialized, render_version,
      editor_document,
      rerender_progress, status, expires_at
    from shorts_mvp.generated_shorts
    where job_id in ${db(jobIds)} and deleted_at is null
      and status in ('ready', 'rerendering')
    order by job_id, clip_index
  `;
  const result = new Map<string, GeneratedShort[]>();
  for (const row of rows) {
    const editorDocument = editorDocumentSnapshotSchema.safeParse(
      row.editorDocument,
    );
    const item: GeneratedShort = {
      id: row.id,
      clipIndex: row.clipIndex,
      startSeconds: Number(row.startSeconds),
      endSeconds: Number(row.endSeconds),
      durationSeconds: Number(row.durationSeconds),
      selectionRawStartSeconds: row.selectionRawStartSeconds == null
        ? null
        : Number(row.selectionRawStartSeconds),
      selectionRawEndSeconds: row.selectionRawEndSeconds == null
        ? null
        : Number(row.selectionRawEndSeconds),
      selectionRawDurationSeconds: row.selectionRawDurationSeconds == null
        ? null
        : Number(row.selectionRawDurationSeconds),
      selectionCandidateIndex: row.selectionCandidateIndex == null
        ? null
        : Number(row.selectionCandidateIndex),
      selectionLengthAdjustment: row.selectionLengthAdjustment || null,
      selectionRepositioned: row.selectionRepositioned == null
        ? null
        : Boolean(row.selectionRepositioned),
      hookTitle: row.hookTitle,
      highlightReason: row.highlightReason || "",
      channelDisplayName: row.channelDisplayName,
      subtitleSegments: row.subtitleSegments,
      commentOverlays: row.commentOverlays || [],
      subtitlesEnabled: row.subtitlesEnabled,
      templateId: row.templateId,
      customTemplateId: row.customTemplateId || null,
      templateSnapshot: row.templateSnapshot || null,
      subtitleTemplateId: row.subtitleTemplateId || null,
      captionRenderSpec: parseCaptionRenderSpec(row.captionRenderSpec),
      videoAspectRatio: row.videoAspectRatio || "1:1",
      titleFontScale: Number(row.titleFontScale),
      titleTextStyles: row.titleTextStyles || [],
      titleTextStylesInitialized: Boolean(row.titleTextStylesInitialized),
      renderVersion: row.renderVersion,
      editorDocument: editorDocument.success
        ? editorDocument.data as EditorDocumentSnapshot
        : null,
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

export async function getAllProjects(db: Sql, session: MvpSession): Promise<VideoJob[]> {
  const rows = await db`
    select * from shorts_mvp.video_jobs
    where ((${session.userId}::uuid is not null and user_id=${session.userId})
      or (${session.userId}::uuid is null and user_id is null and mvp_session_id=${session.id})
      or (is_example and status='completed'))
    order by is_example desc, created_at desc
  `;
  return mapJobs(db, rows);
}

export async function getProjectByNumber(
  db: Sql,
  session: MvpSession,
  projectNumber: number,
): Promise<VideoJob | null> {
  const rows = await db`
    select * from shorts_mvp.video_jobs
    where project_number=${projectNumber} and (
      (${session.userId}::uuid is not null and user_id=${session.userId})
      or (${session.userId}::uuid is null and user_id is null and mvp_session_id=${session.id})
      or (is_example and status='completed')
    )
    limit 1
  `;
  return (await mapJobs(db, rows))[0] || null;
}

export async function getPublicExampleJobs(db: Sql): Promise<VideoJob[]> {
  const rows = await db`
    select * from shorts_mvp.video_jobs
    where is_example and status='completed'
    order by created_at desc limit 10
  `;
  return mapJobs(db, rows);
}

export async function getPublicExampleProjectByNumber(
  db: Sql,
  projectNumber: number,
): Promise<VideoJob | null> {
  const rows = await db`
    select * from shorts_mvp.video_jobs
    where project_number=${projectNumber} and is_example and status='completed'
    limit 1
  `;
  return (await mapJobs(db, rows))[0] || null;
}

async function mapJobs(db: Sql, rows: Row[]): Promise<VideoJob[]> {
  const shorts = await getShortsForJobs(db, rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    projectNumber: Number(row.projectNumber),
    isExample: Boolean(row.isExample),
    videoTitle: row.videoTitle,
    channelName: row.channelName,
    channelThumbnailUrl: row.channelThumbnailUrl || null,
    thumbnailUrl: row.thumbnailUrl,
    sourceDurationSeconds: row.sourceDurationSeconds,
    outputLanguage: row.outputLanguage,
    expectedShortCount: row.expectedShortCount,
    plannedShortCount: Number(row.plannedShortCount ?? row.expectedShortCount),
    readyShortCount: Number(row.readyShortCount ?? 0),
    failedShortCount: Number(row.failedShortCount ?? 0),
    renderSuccessPercent: row.renderSuccessPercent == null
      ? null
      : Number(row.renderSuccessPercent),
    wordTimedSubtitlesAvailable: hasWordTimedTranscription({
      policy: row.transcriptionPolicy,
      provider: row.transcriptionProviderUsed,
      model: row.transcriptionModelUsed,
    }),
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    stageCompletedCount: Number(row.stageCompletedCount ?? 0),
    stageTotalCount: Number(row.stageTotalCount ?? 0),
    errorMessage: row.errorMessage
      ? userFacingErrorMessage(
          row.errorMessage,
          "쇼츠 제작 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
        )
      : null,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    shorts: shorts.get(row.id) || [],
  })) as VideoJob[];
}
