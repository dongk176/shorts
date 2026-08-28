import type { Row, Sql } from "postgres";
import type { GeneratedShort, Plan, VideoJob } from "@/lib/contracts";
import {
  editorDocumentSnapshotSchema,
  parseInitialEditorRenderSpec,
} from "@/lib/editor-document-contract";
import type { EditorDocumentSnapshot } from "@/lib/editor-document-snapshot";
import { parseCaptionRenderSpec } from "@/lib/caption-render-spec";
import { hasWordTimedTranscription } from "@/lib/transcription-release";
import { isUnifiedTemplateSubtitleSnapshot } from "@/lib/template-execution-snapshot";
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

type ShortsForJobsOptions = {
  includeExactWordTimingAvailability?: boolean;
};

function sessionOwnership(session: MvpSession) {
  const userId = session.userId?.trim() || null;
  return {
    userId,
    anonymousSessionId: userId ? null : session.id.trim() || null,
  };
}

async function getWordTimedShortIds(db: Sql, jobIds: string[]) {
  if (!jobIds.length) return new Set<string>();
  const rows = await db`
    with selected_transcripts as materialized (
      select transcript.job_id,transcript.words,
        case
          when jsonb_typeof(transcript.words)='array'
          then jsonb_array_length(transcript.words)>0
            and not exists (
              select 1
              from jsonb_array_elements(transcript.words) candidate
              where jsonb_typeof(candidate->'text') is distinct from 'string'
                or btrim(candidate->>'text')=''
                or jsonb_typeof(candidate->'start') is distinct from 'number'
                or jsonb_typeof(candidate->'end') is distinct from 'number'
                or case
                  when jsonb_typeof(candidate->'start')='number'
                    and jsonb_typeof(candidate->'end')='number'
                  then (candidate->>'start')::numeric<0
                    or (candidate->>'end')::numeric
                      <=(candidate->>'start')::numeric
                  else true
                end
            )
          else false
        end as valid_word_timing
      from shorts_mvp.job_transcripts transcript
      where transcript.job_id in ${db(jobIds)}
    )
    select generated_short.id
    from shorts_mvp.generated_shorts generated_short
    join selected_transcripts transcript
      on transcript.job_id=generated_short.job_id
    where generated_short.job_id in ${db(jobIds)}
      and generated_short.deleted_at is null
      and generated_short.status in ('ready','rerendering')
      and transcript.valid_word_timing
      and exists (
        select 1
        from jsonb_array_elements(
          case
            when jsonb_typeof(transcript.words)='array'
            then transcript.words
            else '[]'::jsonb
          end
        ) word
        where case
          when jsonb_typeof(word->'start')='number'
            and jsonb_typeof(word->'end')='number'
          then (word->>'end')::numeric > coalesce(
            generated_short.edit_timeline_start_seconds,
            generated_short.start_seconds
          )
            and (word->>'start')::numeric < coalesce(
              generated_short.edit_timeline_end_seconds,
              generated_short.end_seconds
            )
          else false
        end
      )
  `;
  return new Set(rows.map((row) => String(row.id)));
}

export async function getShortsForJobs(
  db: Sql,
  jobIds: string[],
  options: ShortsForJobsOptions = {},
) {
  if (!jobIds.length) return new Map<string, GeneratedShort[]>();
  const rows = await db`
    select id, job_id, clip_index, start_seconds, end_seconds, duration_seconds,
      selection_raw_start_seconds, selection_raw_end_seconds,
      selection_raw_duration_seconds, selection_candidate_index,
      selection_length_adjustment, selection_repositioned,
      viral_score,
      hook_title, highlight_reason, channel_display_name, subtitle_segments, subtitles_enabled,
      comment_overlays, template_id, custom_template_id, template_snapshot, video_aspect_ratio, title_font_scale, title_text_styles,
      subtitle_template_id, subtitle_template_snapshot, caption_render_spec,
      title_text_styles_initialized, render_version,
      initial_render_spec, editor_document,
      rerender_progress, status, expires_at
    from shorts_mvp.generated_shorts
    where job_id in ${db(jobIds)} and deleted_at is null
      and status in ('ready', 'rerendering')
    order by job_id, clip_index
  `;
  const wordTimedShortIds = options.includeExactWordTimingAvailability
    ? await getWordTimedShortIds(db, jobIds)
    : new Set<string>();
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
      viralScore: row.viralScore == null ? null : Number(row.viralScore),
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
      unifiedTemplateSubtitle: isUnifiedTemplateSubtitleSnapshot(
        row.subtitleTemplateSnapshot,
      ),
      captionRenderSpec: parseCaptionRenderSpec(row.captionRenderSpec),
      wordTimedSubtitlesAvailable: wordTimedShortIds.has(String(row.id)),
      videoAspectRatio: row.videoAspectRatio || "1:1",
      titleFontScale: Number(row.titleFontScale),
      titleTextStyles: row.titleTextStyles || [],
      titleTextStylesInitialized: Boolean(row.titleTextStylesInitialized),
      renderVersion: row.renderVersion,
      initialRenderSpec: parseInitialEditorRenderSpec(row.initialRenderSpec),
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
  const owner = sessionOwnership(session);
  const rows = onlyJobId
    ? await db`
        select * from shorts_mvp.video_jobs
        where id = ${onlyJobId} and user_deleted_at is null and (
          (${owner.userId}::uuid is not null and user_id=${owner.userId})
          or (${owner.userId}::uuid is null and user_id is null and mvp_session_id=${owner.anonymousSessionId})
          or (is_example and status='completed')
        )
      `
    : await db`
        select * from shorts_mvp.video_jobs
        where user_deleted_at is null and ((${owner.userId}::uuid is not null and user_id=${owner.userId})
          or (${owner.userId}::uuid is null and user_id is null and mvp_session_id=${owner.anonymousSessionId})
          or (is_example and status='completed'))
        order by is_example desc, created_at desc limit 10
      `;
  return mapJobs(db, rows);
}

export async function getAllProjects(db: Sql, session: MvpSession): Promise<VideoJob[]> {
  const owner = sessionOwnership(session);
  const rows = await db`
    select * from shorts_mvp.video_jobs
    where user_deleted_at is null and ((${owner.userId}::uuid is not null and user_id=${owner.userId})
      or (${owner.userId}::uuid is null and user_id is null and mvp_session_id=${owner.anonymousSessionId})
      or (is_example and status='completed'))
    order by is_example desc, created_at desc
  `;
  return mapJobs(db, rows);
}

export async function getProjectByNumber(
  db: Sql,
  session: MvpSession,
  projectNumber: number,
  options: ShortsForJobsOptions = {},
): Promise<VideoJob | null> {
  const owner = sessionOwnership(session);
  const rows = await db`
    select * from shorts_mvp.video_jobs
    where project_number=${projectNumber} and user_deleted_at is null and (
      (${owner.userId}::uuid is not null and user_id=${owner.userId})
      or (${owner.userId}::uuid is null and user_id is null and mvp_session_id=${owner.anonymousSessionId})
      or (is_example and status='completed')
    )
    limit 1
  `;
  return (await mapJobs(db, rows, options))[0] || null;
}

export async function getAuthenticatedProjectPageAccess(
  db: Sql,
  authUserId: string,
  projectNumber: number,
): Promise<{ appUserId: string; canAccess: boolean } | null> {
  const rows = await db`
    with matched_user as (
      select id
      from shorts_mvp.app_users
      where auth_user_id=${authUserId}
      limit 1
    )
    select
      (select id from matched_user) as app_user_id,
      exists(
        select 1
        from shorts_mvp.video_jobs
        where project_number=${projectNumber}
          and user_deleted_at is null
          and (
            user_id=(select id from matched_user)
            or (is_example and status='completed')
          )
      ) as can_access
  `;
  const appUserId = rows[0]?.appUserId;
  if (typeof appUserId !== "string") return null;
  return {
    appUserId,
    canAccess: Boolean(rows[0]?.canAccess),
  };
}

export async function getPublicExampleJobs(db: Sql): Promise<VideoJob[]> {
  const rows = await db`
    select * from shorts_mvp.video_jobs
    where is_example and status='completed' and user_deleted_at is null
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
      and user_deleted_at is null
    limit 1
  `;
  return (await mapJobs(db, rows))[0] || null;
}

async function mapJobs(
  db: Sql,
  rows: Row[],
  options: ShortsForJobsOptions = {},
): Promise<VideoJob[]> {
  const shorts = await getShortsForJobs(
    db,
    rows.map((row) => row.id),
    options,
  );
  return rows.map((row) => {
    const wordTimedSubtitlesAvailable = typeof row.validWordTimingAvailable === "boolean"
      ? row.validWordTimingAvailable
      : hasWordTimedTranscription({
          policy: row.transcriptionPolicy,
          provider: row.transcriptionProviderUsed,
          model: row.transcriptionModelUsed,
        });
    const jobShorts = shorts.get(row.id) || [];
    return {
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
      wordTimedSubtitlesAvailable,
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
      shorts: options.includeExactWordTimingAvailability
        ? jobShorts
        : jobShorts.map((item) => ({
            ...item,
            wordTimedSubtitlesAvailable,
          })),
    };
  }) as VideoJob[];
}
