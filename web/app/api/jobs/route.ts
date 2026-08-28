import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  expectedShortCount,
  jobDeadlineMinutes,
  sourceRangeJobDeadlineMinutes,
  outputLanguages,
  templateIds,
  videoAspectRatios,
} from "@/lib/contracts";
import { wakeOutboxDispatcher } from "@/lib/aws";
import { getBillingSummary } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { assertEnterpriseSessionServiceAccess } from "@/lib/enterprise-access";
import {
  projectDispatchTargetForFeatures,
  type ProjectDispatchTarget,
} from "@/lib/job-dispatch";
import { SIMULATED_PROGRESS_START } from "@/lib/creation-progress";
import { apiError, HttpError } from "@/lib/http";
import { getInitialJobBackend } from "@/lib/job-backend";
import { resolveInitialRenderRelease } from "@/lib/initial-render-release";
import { createInitialRenderContract } from "@/lib/initial-render-contract";
import {
  assertJobCreationAllowed,
  assertRestrictedContentCooldown,
  RESTRICTED_CONTENT_FAILURE_LIMIT,
  RESTRICTED_CONTENT_FAILURE_WINDOW_MINUTES,
} from "@/lib/job-policy";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { selectedSourceRange } from "@/lib/source-range";
import {
  getSourceRangeReleaseAccess,
  lockSourceRangeReleaseAccess,
} from "@/lib/source-range-release";
import {
  lockElevenLabsTranscriptionAccess,
} from "@/lib/transcription-release";
import { lockSubtitleTemplateAccess } from "@/lib/subtitle-template-release";
import {
  SUBTITLE_TEMPLATE_BASE_TEMPLATE_ID,
  subtitleCaptionPlacements,
  subtitleTemplateCreationIds,
} from "@/lib/subtitle-templates";
import { billableSourceSeconds, getUsageSnapshot } from "@/lib/usage";
import { assertCustomTemplateAccess } from "@/lib/template-entitlements";
import { templatePresetColors } from "@/lib/template-config";
import {
  resolveTemplateExecutionSnapshot,
} from "@/lib/template-execution-snapshot";
import { assertSupportedSourceVideoDuration } from "@/lib/source-video";
import {
  issueShortsThankYouEventGrantIfEligible,
  type ShortsThankYouEventGrant,
} from "@/lib/shorts-thank-you-event";

const schema = z.object({
  analysisId: z.string().uuid(),
  youtubeUrl: z.string().max(2048).optional(),
  templateId: z.enum(templateIds),
  customTemplateId: z.string().uuid().nullable().optional(),
  videoAspectRatio: z.enum(videoAspectRatios).default("1:1"),
  outputLanguage: z.enum(outputLanguages).default("ko"),
  rightsConfirmed: z.boolean().optional(),
  requestId: z.string().uuid(),
  rangeStartSeconds: z.number().finite().nonnegative().optional(),
  rangeEndSeconds: z.number().finite().positive().optional(),
  subtitleTemplateId: z.enum(subtitleTemplateCreationIds).optional(),
  subtitleCaptionPlacement: z.enum(subtitleCaptionPlacements).optional(),
  brandColor: z.enum(templatePresetColors).optional(),
});

const noShortsThankYouEventReward: ShortsThankYouEventGrant = {
  granted: false,
  grantedSeconds: 0,
  validUntil: null,
};

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    if (input.subtitleCaptionPlacement && !input.subtitleTemplateId) {
      throw new HttpError(400, "자막 위치는 자막 템플릿과 함께 선택해 주세요.");
    }
    if (
      !input.subtitleTemplateId
      && !input.customTemplateId
      && input.templateId === "comment-capture"
      && (input.videoAspectRatio === "4:5" || input.videoAspectRatio === "9:16")
    ) {
      throw new HttpError(400, "기본 댓글 템플릿에서는 세로형과 세로 꽉참 비율을 사용할 수 없습니다.");
    }
    const rightsConfirmed = input.rightsConfirmed === true;
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const enterpriseAccess = await assertEnterpriseSessionServiceAccess(db, session);
    const enterpriseUsage = enterpriseAccess.accountType === "enterprise";
    const executionBackend = getInitialJobBackend();
    const existing = await db`
      select id, project_number, status from shorts_mvp.video_jobs
      where request_id=${input.requestId} and (
        (${session.userId}::uuid is not null and user_id=${session.userId})
        or (${session.userId}::uuid is null and user_id is null and mvp_session_id=${session.id})
      )
    `;
    if (existing[0]) return NextResponse.json({
      jobId: existing[0].id,
      projectNumber: Number(existing[0].projectNumber),
      status: existing[0].status,
      usage: await getUsageSnapshot(db, session),
      shortsThankYouEventReward: noShortsThankYouEventReward,
    });
    // Circuit breaker logic removed to allow continuous testing with proxies.

    const analyses = await db`
      select youtube_url, youtube_video_id, video_title, channel_name,
        channel_thumbnail_url, thumbnail_url, duration_seconds, creation_allowed, creation_block_code,
        creation_block_reason, source_range_selection_enabled
      from shorts_mvp.youtube_analyses
      where id=${input.analysisId} and (
        (${session.userId}::uuid is not null and user_id=${session.userId})
        or (${session.userId}::uuid is null and user_id is null and mvp_session_id=${session.id})
      ) and expires_at > now()
      limit 1
    `;
    if (!analyses[0]) throw new Error("영상 분석 정보가 만료되었습니다. 링크를 다시 확인해 주세요.");
    if (analyses[0].creationAllowed !== true) {
      throw new HttpError(
        409,
        analyses[0].creationBlockReason || "이 영상은 이용 제한이 확인된 영상입니다. 영상 정보를 다시 확인해 주세요.",
      );
    }
    const metadata = {
      normalizedUrl: analyses[0].youtubeUrl,
      videoId: analyses[0].youtubeVideoId,
      title: analyses[0].videoTitle,
      channelName: analyses[0].channelName,
      channelThumbnailUrl: analyses[0].channelThumbnailUrl || null,
      thumbnailUrl: analyses[0].thumbnailUrl,
      durationSeconds: Number(analyses[0].durationSeconds),
    };
    const sourceDurationSeconds = metadata.durationSeconds;
    const sourceRangeSelectionEnabled = analyses[0].sourceRangeSelectionEnabled === true;
    const releaseAccess = sourceRangeSelectionEnabled
      ? await getSourceRangeReleaseAccess(db, session.userId)
      : null;
    assertSupportedSourceVideoDuration(sourceDurationSeconds, { sourceRangeSelectionEnabled });
    let rangeStartSeconds = 0;
    let rangeEndSeconds = sourceDurationSeconds;
    let selectedDurationSeconds = sourceDurationSeconds;
    if (sourceRangeSelectionEnabled) {
      if (!releaseAccess?.enabled) {
        throw new HttpError(
          409,
          "영상 구간 선택 기능이 일시 중지되었습니다. 링크를 다시 확인해 주세요.",
        );
      }
      if (input.rangeStartSeconds === undefined || input.rangeEndSeconds === undefined) {
        throw new HttpError(400, "사용할 영상의 시작과 끝 구간을 선택해 주세요.");
      }
      try {
        const range = selectedSourceRange(
          sourceDurationSeconds,
          input.rangeStartSeconds,
          input.rangeEndSeconds,
        );
        rangeStartSeconds = range.startSeconds;
        rangeEndSeconds = range.endSeconds;
        selectedDurationSeconds = range.durationSeconds;
      } catch (error) {
        throw new HttpError(
          400,
          error instanceof Error ? error.message : "사용할 영상 구간을 확인해 주세요.",
        );
      }
    } else if (input.rangeStartSeconds !== undefined || input.rangeEndSeconds !== undefined) {
      throw new HttpError(409, "현재 계정에서는 영상 구간 선택 기능을 사용할 수 없습니다.");
    }
    const usageSeconds = billableSourceSeconds(selectedDurationSeconds);
    const plannedShortCount = expectedShortCount(selectedDurationSeconds);
    const deadlineMinutes = sourceRangeSelectionEnabled
      ? sourceRangeJobDeadlineMinutes(sourceDurationSeconds)
      : jobDeadlineMinutes(selectedDurationSeconds);
    const jobId = randomUUID();
    let createdProjectNumber: number | null = null;
    let shortsThankYouEventReward = noShortsThankYouEventReward;
    const duplicate = await db.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${session.userId || session.id}, 0))`;
      if (
        sourceRangeSelectionEnabled
        && !(await lockSourceRangeReleaseAccess(tx, session.userId)).enabled
      ) {
        throw new HttpError(
          409,
          "영상 구간 선택 기능이 일시 중지되었습니다. 링크를 다시 확인해 주세요.",
        );
      }
      let subtitleTemplateUsesEnhancedTiming = false;
      if (input.subtitleTemplateId || input.brandColor) {
        const subtitleTemplateAccess = await lockSubtitleTemplateAccess(
          tx,
          session.userId,
        );
        subtitleTemplateUsesEnhancedTiming = subtitleTemplateAccess.enabled;
        if (input.subtitleTemplateId && !subtitleTemplateAccess.enabled) {
          throw new HttpError(
            409,
            "현재 계정에서는 자막 템플릿을 사용할 수 없습니다.",
          );
        }
        if (input.brandColor && !subtitleTemplateAccess.enabled) {
          throw new HttpError(
            403,
            "현재 계정에서는 브랜드 컬러를 사용할 수 없습니다.",
            "SUBTITLE_SUITE_ACCESS_REQUIRED",
          );
        }
      }
      if (input.subtitleTemplateId) {
        if (input.customTemplateId || input.templateId !== SUBTITLE_TEMPLATE_BASE_TEMPLATE_ID) {
          throw new HttpError(
            400,
            "자막 템플릿은 지정된 기본 레이아웃으로만 사용할 수 있습니다.",
          );
        }
        if (executionBackend !== "aws_batch") {
          throw new HttpError(
            503,
            "자막 템플릿 작업을 안전한 전용 워커에 연결하지 못했습니다.",
          );
        }
      }
      if (input.brandColor && executionBackend !== "aws_batch") {
        throw new HttpError(
          503,
          "브랜드 컬러 테스트 작업을 안전한 전용 워커에 연결하지 못했습니다.",
        );
      }
      const usesLegacySubtitleSuiteCandidate = Boolean(
        input.subtitleTemplateId || input.brandColor,
      );
      let transcriptionAccess: Awaited<ReturnType<
        typeof lockElevenLabsTranscriptionAccess
      >> | null = null;
      let dispatchTarget: ProjectDispatchTarget | null = null;
      if (!input.customTemplateId) {
        transcriptionAccess = await lockElevenLabsTranscriptionAccess(
          tx,
          session.userId,
        );
        if (
          usesLegacySubtitleSuiteCandidate
          && !transcriptionAccess.enabled
        ) {
          throw new HttpError(
            409,
            "현재 계정에서는 자막 전사 기능을 사용할 수 없습니다.",
            "SUBTITLE_SUITE_TRANSCRIPTION_DISABLED",
          );
        }
        dispatchTarget = executionBackend !== "aws_batch"
          ? null
          : projectDispatchTargetForFeatures({
              usesUnifiedTemplateSubtitleCandidate: false,
              usesLegacySubtitleSuiteCandidate,
              transcriptionEnabled: transcriptionAccess.enabled,
              sourceRangeSelectionEnabled,
            });
      }
      const concurrentExisting = await tx`
        select id, project_number, status from shorts_mvp.video_jobs
        where request_id=${input.requestId} and (
          (${session.userId}::uuid is not null and user_id=${session.userId})
          or (${session.userId}::uuid is null and user_id is null and mvp_session_id=${session.id})
        )
      `;
      if (concurrentExisting[0]) {
        return {
          id: concurrentExisting[0].id,
          projectNumber: Number(concurrentExisting[0].projectNumber),
          status: concurrentExisting[0].status,
        };
      }
      shortsThankYouEventReward =
        await issueShortsThankYouEventGrantIfEligible(tx, session.userId);
      const billing = await getBillingSummary(tx, session.userId);
      if (input.customTemplateId) {
        assertCustomTemplateAccess(billing);
      }
      const resolvedExecution = await resolveTemplateExecutionSnapshot(tx, {
        userId: session.userId,
        templateId: input.templateId,
        customTemplateId: input.customTemplateId,
        videoAspectRatio: input.videoAspectRatio,
        brandColor: input.brandColor,
      });
      const usesUnifiedTemplateSubtitleCandidate =
        resolvedExecution.usesUnifiedTemplateSubtitleCanary;
      if (
        usesUnifiedTemplateSubtitleCandidate
        && executionBackend !== "aws_batch"
      ) {
        throw new HttpError(
          503,
          "자막 포함 템플릿 작업을 안전한 전용 워커에 연결하지 못했습니다.",
        );
      }
      if (!transcriptionAccess) {
        transcriptionAccess = await lockElevenLabsTranscriptionAccess(
          tx,
          session.userId,
        );
      }
      const usesSubtitleSuiteCandidate = usesLegacySubtitleSuiteCandidate
        || usesUnifiedTemplateSubtitleCandidate;
      if (usesSubtitleSuiteCandidate && !transcriptionAccess.enabled) {
        throw new HttpError(
          409,
          "현재 계정에서는 자막 전사 기능을 사용할 수 없습니다.",
          "SUBTITLE_SUITE_TRANSCRIPTION_DISABLED",
        );
      }
      const transcriptionPolicy = transcriptionAccess.policy;
      if (input.customTemplateId) {
        dispatchTarget = executionBackend !== "aws_batch"
          ? null
          : projectDispatchTargetForFeatures({
              usesUnifiedTemplateSubtitleCandidate,
              usesLegacySubtitleSuiteCandidate,
              transcriptionEnabled: transcriptionAccess.enabled,
              sourceRangeSelectionEnabled,
            });
      }
      let initialRenderSpecVersion: 4 | null = null;
      let initialCaptionRenderSpecVersion: 4 | null = null;
      let initialEditorReleaseId: string | null = null;
      const renderContract = createInitialRenderContract({
        resolvedExecution,
        subtitleTemplateId: input.subtitleTemplateId,
        subtitleCaptionPlacement: input.subtitleCaptionPlacement,
        brandColor: input.brandColor,
        enhancedSubtitleTiming: subtitleTemplateUsesEnhancedTiming,
      });
      const resolvedTemplateId = renderContract.templateId;
      const resolvedVideoAspectRatio = renderContract.videoAspectRatio;
      const templateSnapshot = renderContract.templateSnapshot;
      const subtitleTemplateSnapshot = renderContract.subtitleTemplateSnapshot;
      const limits = await tx`
        with scoped_jobs as (
          select status,error_code,heartbeat_at
          from shorts_mvp.video_jobs
          where (
            (${session.userId}::uuid is not null and user_id=${session.userId})
            or (${session.userId}::uuid is null and user_id is null and mvp_session_id=${session.id})
          )
        ), restricted_failures as (
          select count(*)::int as failure_count,max(heartbeat_at) as last_failed_at
          from scoped_jobs
          where status='failed'
            and error_code in ('youtube_members_only','youtube_paid_content')
            and heartbeat_at >= clock_timestamp()
              - ${RESTRICTED_CONTENT_FAILURE_WINDOW_MINUTES} * interval '1 minute'
        )
        select
          (select count(*)::int from scoped_jobs where status in (
            'validating','queued','starting','downloading','transcribing','selecting',
            'extracting','rendering','uploading','retry_waiting'
          )) as active,
          case
            when restricted_failures.failure_count >= ${RESTRICTED_CONTENT_FAILURE_LIMIT}
            then greatest(1,ceil(extract(epoch from (
              restricted_failures.last_failed_at
              + ${RESTRICTED_CONTENT_FAILURE_WINDOW_MINUTES} * interval '1 minute'
              - clock_timestamp()
            )) / 60.0)::int)
            else 0
          end as restricted_content_cooldown_minutes
        from restricted_failures
      `;
      assertRestrictedContentCooldown(
        Number(limits[0].restrictedContentCooldownMinutes || 0),
      );
      const beforeUsage = await getUsageSnapshot(tx, session);
      if (beforeUsage.enforcementEnabled && !billing.canCreateJobs) {
        throw new HttpError(402, "쇼츠를 만들려면 활성 구독이 필요합니다.");
      }
      assertJobCreationAllowed({
        activeJobs: limits[0].active,
        maxActiveJobs: beforeUsage.enforcementEnabled ? billing.maxActiveJobs : 1,
        sourceDurationSeconds: usageSeconds,
        usage: beforeUsage,
      });
      // Keep the authoritative v4 admission as the last read before INSERT.
      // The DB resolver takes shared locks on the runtime/state rows until this
      // transaction commits, so an emergency stop or infrastructure lease is
      // strictly ordered before or after this job instead of racing the INSERT.
      const initialRenderRelease = await resolveInitialRenderRelease(tx, {
        userId: session.userId,
        dispatchTarget,
      });
      if (initialRenderRelease) {
        initialEditorReleaseId = initialRenderRelease.releaseId;
        initialRenderSpecVersion = 4;
        initialCaptionRenderSpecVersion = 4;
      }
      const insertedJobs = await tx`
        insert into shorts_mvp.video_jobs (
          id, mvp_session_id, user_id, request_id, youtube_url, youtube_video_id, video_title,
          channel_name, channel_thumbnail_url, thumbnail_url, source_duration_seconds, range_start_seconds,
          range_end_seconds, template_id, custom_template_id, template_snapshot, video_aspect_ratio,
          subtitle_template_id, subtitle_template_snapshot,
          clip_length_option, output_language, expected_short_count, rights_confirmed, execution_backend,
          status, stage, progress, deadline_at, planned_short_count,retention_days_snapshot,
          pipeline_version, source_range_selection_enabled, transcription_policy,
          batch_target_key, batch_target_release_id,
          batch_job_definition, batch_job_queue,
          initial_editor_release_id,
          initial_render_spec_version, initial_caption_render_spec_version
          ,selected_source_duration_seconds,billable_source_seconds
        ) values (
          ${jobId}, ${session.id}, ${session.userId}, ${input.requestId}, ${metadata.normalizedUrl}, ${metadata.videoId}, ${metadata.title},
          ${metadata.channelName}, ${metadata.channelThumbnailUrl}, ${metadata.thumbnailUrl}, ${sourceDurationSeconds}, ${rangeStartSeconds},
          ${rangeEndSeconds}, ${resolvedTemplateId}, ${input.customTemplateId || null}, ${templateSnapshot ? tx.json(templateSnapshot) : null}, ${resolvedVideoAspectRatio},
          ${subtitleTemplateSnapshot?.subtitleTemplateId || null}, ${subtitleTemplateSnapshot ? tx.json(subtitleTemplateSnapshot) : null},
          'sec_31_60', ${input.outputLanguage}, ${plannedShortCount},
          ${rightsConfirmed}, ${executionBackend}, 'queued', 'queued', ${SIMULATED_PROGRESS_START},
          now() + ${deadlineMinutes} * interval '1 minute', ${plannedShortCount},${billing.retentionDays},
          ${executionBackend === "aws_batch" ? 2 : 1}, ${sourceRangeSelectionEnabled},
          ${transcriptionPolicy},
          ${dispatchTarget?.targetKey || null}, ${dispatchTarget?.releaseId || null},
          ${dispatchTarget?.jobDefinitionArn || null},
          ${dispatchTarget?.jobQueueArn || null},
          ${initialEditorReleaseId},
          ${initialRenderSpecVersion}, ${initialCaptionRenderSpecVersion},
          ${selectedDurationSeconds},${usageSeconds}
        )
        returning project_number
      `;
      createdProjectNumber = Number(insertedJobs[0].projectNumber);
      const reservations = await tx`
        insert into shorts_mvp.usage_reservations (mvp_session_id, user_id, job_id, source_duration_seconds)
        values (${session.id}, ${session.userId}, ${jobId}, ${usageSeconds})
        returning id
      `;
      if (beforeUsage.enforcementEnabled) {
        if (enterpriseUsage) {
          await tx`select shorts_mvp.reserve_enterprise_usage_grants(
            ${session.userId},${reservations[0].id},${usageSeconds}
          )`;
        } else {
          await tx`select shorts_mvp.reserve_usage_grants(
            ${session.userId},${reservations[0].id},${usageSeconds}
          )`;
        }
      }
      if (executionBackend === "aws_batch") {
        await tx`select shorts_mvp.initialize_project_output_attempts(${jobId})`;
        await tx`
          insert into shorts_mvp.project_job_outbox (job_id)
          values (${jobId})
        `;
      }
      return null;
    });
    if (duplicate) {
      return NextResponse.json({
        jobId: duplicate.id,
        projectNumber: duplicate.projectNumber,
        status: duplicate.status,
        usage: await getUsageSnapshot(db, session),
        shortsThankYouEventReward: noShortsThankYouEventReward,
      });
    }
    if (!createdProjectNumber || !Number.isSafeInteger(createdProjectNumber)) {
      throw new Error("프로젝트 번호를 생성하지 못했습니다.");
    }

    if (executionBackend === "aws_batch") {
      try {
        await wakeOutboxDispatcher();
      } catch (error) {
        console.error("outbox_dispatch_wake_failed", {
          jobId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }

    return NextResponse.json({
      jobId,
      projectNumber: createdProjectNumber,
      status: "queued",
      executionBackend,
      usage: await getUsageSnapshot(db, session),
      shortsThankYouEventReward,
    }, { status: 202 });
  } catch (error) { return apiError(error); }
}
