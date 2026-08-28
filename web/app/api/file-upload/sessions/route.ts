import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ensureFileUploadCapacity,
  releaseFileUploadCapacity,
} from "@/lib/aws";
import { getBillingSummary } from "@/lib/billing";
import {
  expectedShortCount,
  outputLanguages,
  sourceRangeJobDeadlineMinutes,
  templateIds,
  videoAspectRatios,
} from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { assertEnterpriseSessionServiceAccess } from "@/lib/enterprise-access";
import {
  FILE_UPLOAD_CONTROL_BODY_MAX_BYTES,
  FILE_UPLOAD_MAX_BYTES,
  FILE_UPLOAD_MAX_DURATION_SECONDS,
  FILE_UPLOAD_MIN_DURATION_SECONDS,
  fileUploadBearerToken,
  fileUploadIntentHash,
  fileUploadReceiverUrl,
  fileUploadTokenHash,
  fileUploadTokenMatchesHash,
  getFileUploadReceiverConfig,
  readLimitedJsonBody,
} from "@/lib/file-upload-control";
import {
  getFileUploadReleaseAccess,
  lockFileUploadReleaseAccess,
} from "@/lib/file-upload-release";
import { apiError, HttpError } from "@/lib/http";
import { resolveInitialRenderRelease } from "@/lib/initial-render-release";
import { createInitialRenderContract } from "@/lib/initial-render-contract";
import { projectDispatchTargetForFeatures } from "@/lib/job-dispatch";
import { assertJobCreationAllowed } from "@/lib/job-policy";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import {
  MAX_SELECTED_SOURCE_SECONDS,
  MIN_SELECTED_SOURCE_SECONDS,
} from "@/lib/source-range";
import { issueShortsThankYouEventGrantIfEligible } from "@/lib/shorts-thank-you-event";
import {
  SUBTITLE_TEMPLATE_BASE_TEMPLATE_ID,
  subtitleCaptionPlacements,
  subtitleTemplateCreationIds,
} from "@/lib/subtitle-templates";
import {
  lockSubtitleTemplateAccess,
} from "@/lib/subtitle-template-release";
import { assertCustomTemplateAccess } from "@/lib/template-entitlements";
import { templatePresetColors } from "@/lib/template-config";
import {
  resolveTemplateExecutionSnapshot,
  type ResolvedTemplateExecutionSnapshot,
} from "@/lib/template-execution-snapshot";
import { lockElevenLabsTranscriptionAccess } from "@/lib/transcription-release";
import { billableSourceSeconds, getUsageSnapshot } from "@/lib/usage";

export const dynamic = "force-dynamic";

const millisecondNumber = z.number().finite().transform(
  (value) => Math.round(value * 1_000) / 1_000,
);

const requestSchema = z.object({
  requestId: z.string().uuid(),
  file: z.object({
    name: z.string().min(1).max(1024),
    // Browser MIME is only a declaration. The isolated receiver must probe the
    // uploaded bytes before making the job runnable, so blank/unknown values
    // are valid control-plane metadata.
    contentType: z.string().max(120),
    sizeBytes: z.number().int().min(1).max(FILE_UPLOAD_MAX_BYTES),
    durationSeconds: millisecondNumber
      .pipe(z.number().min(FILE_UPLOAD_MIN_DURATION_SECONDS)
        .max(FILE_UPLOAD_MAX_DURATION_SECONDS)),
    width: z.number().int().min(1).max(8192).nullish(),
    height: z.number().int().min(1).max(8192).nullish(),
    hasAudio: z.boolean(),
  }).strict(),
  rangeStartSeconds: millisecondNumber.pipe(z.number().nonnegative()),
  rangeEndSeconds: millisecondNumber.pipe(z.number().positive()),
  templateId: z.enum(templateIds),
  customTemplateId: z.string().uuid().nullable().optional(),
  videoAspectRatio: z.enum(videoAspectRatios).default("1:1"),
  outputLanguage: z.enum(outputLanguages).default("ko"),
  subtitleTemplateId: z.enum(subtitleTemplateCreationIds).optional(),
  subtitleCaptionPlacement: z.enum(subtitleCaptionPlacements).optional(),
  brandColor: z.enum(templatePresetColors).optional(),
  rightsConfirmed: z.boolean(),
}).strict().superRefine((input, context) => {
  if (!input.file.hasAudio) {
    context.addIssue({
      code: "custom",
      path: ["file", "hasAudio"],
      message: "오디오가 포함된 영상을 선택해 주세요.",
    });
  }
  if (!input.rightsConfirmed) {
    context.addIssue({
      code: "custom",
      path: ["rightsConfirmed"],
      message: "원본 영상 권리를 확인해 주세요.",
    });
  }
  if (
    input.file.width
    && input.file.height
    && input.file.width * input.file.height > 33_554_432
  ) {
    context.addIssue({
      code: "custom",
      path: ["file", "width"],
      message: "영상 해상도가 허용 범위를 초과합니다.",
    });
  }
  if (input.subtitleCaptionPlacement && !input.subtitleTemplateId) {
    context.addIssue({
      code: "custom",
      path: ["subtitleCaptionPlacement"],
      message: "자막 위치는 자막 템플릿과 함께 선택해 주세요.",
    });
  }
  if (input.rangeEndSeconds <= input.rangeStartSeconds) {
    context.addIssue({
      code: "custom",
      path: ["rangeEndSeconds"],
      message: "선택 구간의 시작과 끝을 확인해 주세요.",
    });
    return;
  }
  if (input.rangeEndSeconds > input.file.durationSeconds) {
    context.addIssue({
      code: "custom",
      path: ["rangeEndSeconds"],
      message: "선택 범위가 영상 길이를 초과합니다.",
    });
    return;
  }
  const selectedSeconds = input.rangeEndSeconds - input.rangeStartSeconds;
  if (input.file.durationSeconds < MIN_SELECTED_SOURCE_SECONDS) {
    if (
      input.rangeStartSeconds !== 0
      || input.rangeEndSeconds !== input.file.durationSeconds
    ) {
      context.addIssue({
        code: "custom",
        path: ["rangeEndSeconds"],
        message: "4분 미만 영상은 전체 구간을 선택해 주세요.",
      });
    }
    return;
  }
  if (
    selectedSeconds < MIN_SELECTED_SOURCE_SECONDS
    || selectedSeconds > MAX_SELECTED_SOURCE_SECONDS
  ) {
    context.addIssue({
      code: "custom",
      path: ["rangeEndSeconds"],
      message: "4분부터 60분까지의 구간을 선택해 주세요.",
    });
  }
});

type UploadIntentRow = {
  uploadSessionId: string;
  jobId: string;
  projectNumber: number;
  requestId: string;
  userId: string;
  tokenHash: string;
  intentHash: string;
  uploadUrl: string;
  expiresAt: Date | string;
  status: string;
  isUnexpired: boolean;
};

function hiddenNotFound() {
  return new HttpError(404, "찾을 수 없습니다.", "NOT_FOUND");
}

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function sanitizedDisplayFilename(value: string) {
  const basename = value
    .normalize("NFKC")
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim()
    .slice(0, 255);
  if (!basename || basename === "." || basename === "..") {
    throw new HttpError(400, "파일 이름을 확인해 주세요.");
  }
  return basename;
}

async function requireHiddenAuthenticatedSession() {
  try {
    const session = await requireAuthenticatedMvpSession();
    if (!session.id || !session.userId) throw hiddenNotFound();
    return session;
  } catch {
    // Do not reveal the canary to signed-out or unlinked accounts.
    throw hiddenNotFound();
  }
}

function assertJsonControlRequest(request: Request) {
  const contentType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(415, "JSON 요청만 사용할 수 있습니다.");
  }
}

function tokenForRow(secret: string, row: UploadIntentRow) {
  const token = fileUploadBearerToken(secret, {
    uploadSessionId: row.uploadSessionId,
    jobId: row.jobId,
    userId: row.userId,
    requestId: row.requestId,
  });
  if (!fileUploadTokenMatchesHash(token, row.tokenHash)) {
    throw new HttpError(
      503,
      "파일 업로드 인증 정보를 확인하지 못했습니다.",
      "FILE_UPLOAD_TOKEN_CONFIGURATION_MISMATCH",
    );
  }
  return token;
}

async function cancelUnclaimedSessionAfterCapacityFailure(
  db: ReturnType<typeof getDb>,
  input: { userId: string; uploadSessionId: string; jobId: string },
) {
  await db.begin(async (tx) => {
    await tx`
      select pg_advisory_xact_lock(hashtextextended(${input.userId},0))
    `;
    const rows = await tx`
      select upload.status,upload.consumed_at
      from shorts_mvp.upload_sessions upload
      join shorts_mvp.video_jobs job on job.id=upload.job_id
      where upload.id=${input.uploadSessionId}
        and upload.job_id=${input.jobId}
        and upload.user_id=${input.userId}
        and job.user_id=${input.userId}
      limit 1
      for update of upload,job
    `;
    if (
      rows[0]?.status !== "awaiting_upload"
      || rows[0]?.consumedAt !== null
    ) return;
    await tx`
      update shorts_mvp.upload_sessions
      set status='failed',
          failure_code='upload_capacity_unavailable',
          failure_reason='업로드 작업 서버를 준비하지 못했습니다.',
          source_deleted_at=coalesce(source_deleted_at,clock_timestamp()),
          completed_at=coalesce(completed_at,clock_timestamp())
      where id=${input.uploadSessionId} and status='awaiting_upload'
    `;
    await tx`
      select * from shorts_mvp.finalize_project_job(
        ${input.jobId},
        'upload_capacity_unavailable',
        '업로드 작업 서버를 준비하지 못했습니다.'
      )
    `;
  });
}

export async function GET() {
  return noStore(apiError(hiddenNotFound()));
}

export async function POST(request: Request) {
  try {
    const session = await requireHiddenAuthenticatedSession();
    const db = getDb();
    const enterpriseAccess = await assertEnterpriseSessionServiceAccess(db, session);
    const enterpriseUsage = enterpriseAccess.accountType === "enterprise";
    const access = await getFileUploadReleaseAccess(db, session.userId);
    if (!access.enabled) throw hiddenNotFound();

    assertJsonControlRequest(request);
    const input = requestSchema.parse(await readLimitedJsonBody(
      request,
      FILE_UPLOAD_CONTROL_BODY_MAX_BYTES,
    ));
    const originalFilename = sanitizedDisplayFilename(input.file.name);
    const declaredContentType = input.file.contentType
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase() || "application/octet-stream";
    const intentHash = fileUploadIntentHash({
      originalFilename,
      declaredContentType,
      sizeBytes: input.file.sizeBytes,
      durationSeconds: input.file.durationSeconds,
      width: input.file.width ?? null,
      height: input.file.height ?? null,
      hasAudio: input.file.hasAudio,
      rangeStartSeconds: input.rangeStartSeconds,
      rangeEndSeconds: input.rangeEndSeconds,
      templateId: input.templateId,
      customTemplateId: input.customTemplateId ?? null,
      videoAspectRatio: input.videoAspectRatio,
      outputLanguage: input.outputLanguage,
      subtitleTemplateId: input.subtitleTemplateId ?? null,
      subtitleCaptionPlacement: input.subtitleTemplateId
        ? input.subtitleCaptionPlacement ?? "lower"
        : null,
      brandColor: input.brandColor ?? null,
      rightsConfirmed: input.rightsConfirmed,
    });
    if (
      !input.subtitleTemplateId
      && !input.customTemplateId
      && input.templateId === "comment-capture"
      && (input.videoAspectRatio === "4:5" || input.videoAspectRatio === "9:16")
    ) {
      throw new HttpError(
        400,
        "기본 댓글 템플릿에서는 세로형과 세로 꽉참 비율을 사용할 수 없습니다.",
      );
    }

    const selectedDurationSeconds = Math.round(
      (input.rangeEndSeconds - input.rangeStartSeconds) * 1_000,
    ) / 1_000;
    const usageSeconds = billableSourceSeconds(selectedDurationSeconds);
    const plannedShortCount = expectedShortCount(selectedDurationSeconds);
    const sourceDurationSeconds = Math.ceil(input.file.durationSeconds);
    const sourceRangeSelectionEnabled = input.file.durationSeconds
      >= MIN_SELECTED_SOURCE_SECONDS;
    const deadlineMinutes = sourceRangeJobDeadlineMinutes(sourceDurationSeconds);

    const result = await db.begin(async (tx) => {
      await tx`
        select pg_advisory_xact_lock(hashtextextended(${session.userId},0))
      `;
      const lockedAccess = await lockFileUploadReleaseAccess(tx, session.userId);
      if (!lockedAccess.enabled) throw hiddenNotFound();

      // Resolve receiver credentials only after both administrator gates pass,
      // so hidden callers always see the same 404 regardless of configuration.
      const receiver = getFileUploadReceiverConfig();
      const existingRows = await tx`
        select
          upload.id as upload_session_id,
          upload.job_id,
          job.project_number,
          upload.request_id,
          upload.user_id,
          upload.token_hash,
          upload.intent_hash,
          upload.upload_url,
          upload.expires_at,
          upload.status,
          (upload.expires_at>clock_timestamp()) as is_unexpired
        from shorts_mvp.upload_sessions upload
        join shorts_mvp.video_jobs job on job.id=upload.job_id
        where upload.request_id=${input.requestId}
          and upload.user_id=${session.userId}
        limit 1
      `;
      if (existingRows[0]) {
        const existing = existingRows[0] as UploadIntentRow;
        if (existing.intentHash !== intentHash) {
          throw new HttpError(
            409,
            "같은 업로드 요청 번호에 다른 영상 설정을 사용할 수 없습니다.",
            "FILE_UPLOAD_INTENT_MISMATCH",
          );
        }
        if (!existing.isUnexpired || existing.status === "expired") {
          throw new HttpError(
            410,
            "파일 업로드 시간이 만료되었습니다.",
            "FILE_UPLOAD_SESSION_EXPIRED",
          );
        }
        if (existing.status === "claimed") {
          throw new HttpError(
            409,
            "원본 업로드 처리가 이미 시작되었습니다.",
            "FILE_UPLOAD_ALREADY_CLAIMED",
          );
        }
        if (existing.status !== "awaiting_upload") {
          throw new HttpError(
            409,
            "이 요청은 더 이상 업로드에 사용할 수 없습니다.",
            "FILE_UPLOAD_REQUEST_NOT_ACTIVE",
          );
        }
        return {
          ...existing,
          projectNumber: Number(existing.projectNumber),
          token: tokenForRow(receiver.tokenSecret, existing),
          created: false,
        };
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
            "현재 계정에서는 자막 템플릿 테스트를 사용할 수 없습니다.",
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
      if (
        input.subtitleTemplateId
        && (input.customTemplateId || input.templateId !== SUBTITLE_TEMPLATE_BASE_TEMPLATE_ID)
      ) {
        throw new HttpError(
          400,
          "자막 템플릿은 지정된 기본 레이아웃으로만 사용할 수 있습니다.",
        );
      }

      const customTemplateBilling = input.customTemplateId
        ? await getBillingSummary(tx, session.userId)
        : null;
      if (customTemplateBilling) {
        assertCustomTemplateAccess(customTemplateBilling);
      }
      let resolvedExecution: ResolvedTemplateExecutionSnapshot | null = null;
      if (input.customTemplateId) {
        resolvedExecution = await resolveTemplateExecutionSnapshot(tx, {
          userId: session.userId,
          templateId: input.templateId,
          customTemplateId: input.customTemplateId,
          videoAspectRatio: input.videoAspectRatio,
          brandColor: input.brandColor,
        });
      }

      const usesSubtitleSuiteCandidate = Boolean(
        input.subtitleTemplateId
          || input.brandColor
          || resolvedExecution?.usesUnifiedTemplateSubtitleCanary,
      );
      const transcriptionAccess = await lockElevenLabsTranscriptionAccess(
        tx,
        session.userId,
      );
      if (usesSubtitleSuiteCandidate && !transcriptionAccess.enabled) {
        throw new HttpError(
          409,
          "현재 계정에서는 자막 전사 기능을 사용할 수 없습니다.",
          "SUBTITLE_SUITE_TRANSCRIPTION_DISABLED",
        );
      }

      // Match the stable link path's preflight grant ordering so the usage
      // snapshot and reservation see the same eligible balance.
      await issueShortsThankYouEventGrantIfEligible(tx, session.userId);
      const billing = customTemplateBilling
        ?? await getBillingSummary(tx, session.userId);
      resolvedExecution ??= await resolveTemplateExecutionSnapshot(tx, {
        userId: session.userId,
        templateId: input.templateId,
        customTemplateId: input.customTemplateId,
        videoAspectRatio: input.videoAspectRatio,
        brandColor: input.brandColor,
      });
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
      const dispatchTarget = projectDispatchTargetForFeatures({
        usesUnifiedTemplateSubtitleCandidate:
          resolvedExecution.usesUnifiedTemplateSubtitleCanary,
        usesLegacySubtitleSuiteCandidate: Boolean(
          input.subtitleTemplateId || input.brandColor,
        ),
        transcriptionEnabled: transcriptionAccess.enabled,
        sourceRangeSelectionEnabled,
      });

      const limits = await tx`
        select count(*)::int as active
        from shorts_mvp.video_jobs
        where user_id=${session.userId}
          and status in (
            'validating','queued','starting','downloading','transcribing',
            'selecting','extracting','rendering','uploading','retry_waiting'
          )
      `;
      const beforeUsage = await getUsageSnapshot(tx, session);
      if (beforeUsage.enforcementEnabled && !billing.canCreateJobs) {
        throw new HttpError(402, "쇼츠를 만들려면 활성 구독이 필요합니다.");
      }
      assertJobCreationAllowed({
        activeJobs: Number(limits[0]?.active || 0),
        maxActiveJobs: beforeUsage.enforcementEnabled
          ? billing.maxActiveJobs
          : 1,
        sourceDurationSeconds: usageSeconds,
        usage: beforeUsage,
      });

      // File uploads must never silently fall back to the legacy renderer.
      // Resolve the exact same release as the corresponding link job while
      // the runtime release rows remain locked by this creation transaction.
      const initialRenderRelease = await resolveInitialRenderRelease(tx, {
        userId: session.userId,
        dispatchTarget,
      });
      if (!initialRenderRelease) {
        throw new HttpError(
          503,
          "파일 업로드 렌더 릴리스를 안전하게 확인하지 못했습니다.",
          "FILE_UPLOAD_RENDER_RELEASE_UNAVAILABLE",
        );
      }

      const projectNumberRows = await tx`
        select nextval('shorts_mvp.video_job_project_number_seq')::bigint
          as project_number
      `;
      const projectNumber = Number(projectNumberRows[0]?.projectNumber);
      if (!Number.isSafeInteger(projectNumber) || projectNumber <= 0) {
        throw new Error("프로젝트 번호를 생성하지 못했습니다.");
      }

      const jobId = randomUUID();
      const uploadSessionId = randomUUID();
      const thumbnailUrl = `/api/projects/${projectNumber}/source-thumbnail`;
      const uploadUrl = fileUploadReceiverUrl(
        receiver.receiverBaseUrl,
        uploadSessionId,
      );
      const token = fileUploadBearerToken(receiver.tokenSecret, {
        uploadSessionId,
        jobId,
        userId: session.userId,
        requestId: input.requestId,
      });
      const tokenHash = fileUploadTokenHash(token);

      await tx`
        insert into shorts_mvp.video_jobs (
          id,project_number,mvp_session_id,user_id,request_id,
          youtube_url,youtube_video_id,video_title,channel_name,
          channel_thumbnail_url,thumbnail_url,source_duration_seconds,
          range_start_seconds,range_end_seconds,template_id,
          custom_template_id,template_snapshot,video_aspect_ratio,
          subtitle_template_id,subtitle_template_snapshot,
          clip_length_option,output_language,expected_short_count,
          rights_confirmed,execution_backend,status,stage,progress,
          deadline_at,planned_short_count,retention_days_snapshot,
          pipeline_version,source_range_selection_enabled,
          transcription_policy,batch_job_definition,batch_job_queue,
          selected_source_duration_seconds,billable_source_seconds,
          source_type,initial_editor_release_id,
          initial_render_spec_version,initial_caption_render_spec_version
        ) values (
          ${jobId},${projectNumber},${session.id},${session.userId},${input.requestId},
          ${null},${null},${originalFilename},${"업로드한 영상"},
          ${null},${thumbnailUrl},${sourceDurationSeconds},
          ${input.rangeStartSeconds},${input.rangeEndSeconds},${resolvedTemplateId},
          ${input.customTemplateId || null},${tx.json(templateSnapshot)},${resolvedVideoAspectRatio},
          ${subtitleTemplateSnapshot?.subtitleTemplateId || null},
          ${subtitleTemplateSnapshot ? tx.json(subtitleTemplateSnapshot) : null},
          'sec_31_60',${input.outputLanguage},${plannedShortCount},
          ${true},'upload_service','uploading','uploading',0,
          now() + ${deadlineMinutes} * interval '1 minute',${plannedShortCount},
          ${billing.retentionDays},2,${sourceRangeSelectionEnabled},
          ${transcriptionAccess.policy},${null},${null},
          ${selectedDurationSeconds},${usageSeconds},'upload',
          ${initialRenderRelease.releaseId},4,4
        )
      `;
      const reservations = await tx`
        insert into shorts_mvp.usage_reservations (
          mvp_session_id,user_id,job_id,source_duration_seconds
        ) values (
          ${session.id},${session.userId},${jobId},${usageSeconds}
        )
        returning id
      `;
      if (!reservations[0]?.id) {
        throw new Error("사용량을 예약하지 못했습니다.");
      }
      if (beforeUsage.enforcementEnabled) {
        if (enterpriseUsage) {
          await tx`
            select shorts_mvp.reserve_enterprise_usage_grants(
              ${session.userId},${reservations[0].id},${usageSeconds}
            )
          `;
        } else {
          await tx`
            select shorts_mvp.reserve_usage_grants(
              ${session.userId},${reservations[0].id},${usageSeconds}
            )
          `;
        }
      }
      await tx`select shorts_mvp.initialize_project_output_attempts(${jobId})`;

      const insertedSessions = await tx`
        insert into shorts_mvp.upload_sessions (
          id,mvp_session_id,user_id,request_id,job_id,
          intent_hash,
          original_filename,declared_content_type,expected_bytes,
          declared_duration_seconds,declared_width,declared_height,
          declared_has_audio,range_start_seconds,range_end_seconds,
          rights_confirmed,token_hash,upload_url,expires_at
        ) values (
          ${uploadSessionId},${session.id},${session.userId},${input.requestId},${jobId},
          ${intentHash},
          ${originalFilename},${declaredContentType},${input.file.sizeBytes},
          ${input.file.durationSeconds},${input.file.width ?? null},
          ${input.file.height ?? null},${input.file.hasAudio},
          ${input.rangeStartSeconds},${input.rangeEndSeconds},${true},
          ${tokenHash},${uploadUrl},now() + interval '15 minutes'
        )
        returning expires_at
      `;
      if (!insertedSessions[0]?.expiresAt) {
        throw new Error("업로드 세션을 생성하지 못했습니다.");
      }

      return {
        uploadSessionId,
        jobId,
        projectNumber,
        requestId: input.requestId,
        userId: session.userId,
        tokenHash,
        token,
        uploadUrl,
        expiresAt: insertedSessions[0].expiresAt,
        created: true,
      };
    });

    let capacity: Awaited<ReturnType<typeof ensureFileUploadCapacity>>;
    try {
      capacity = await ensureFileUploadCapacity({
        // The capacity coordinator owns the authoritative count through one
        // expiring lease per upload session. Recounting stale database rows here
        // could over-scale or race concurrent requests.
        desiredCount: 1,
        uploadSessionId: result.uploadSessionId,
        expiresAt: result.expiresAt,
      });
    } catch {
      await cancelUnclaimedSessionAfterCapacityFailure(db, {
        userId: session.userId,
        uploadSessionId: result.uploadSessionId,
        jobId: result.jobId,
      });
      await releaseFileUploadCapacity(result.uploadSessionId).catch(() => undefined);
      throw new HttpError(
        503,
        "업로드 작업 서버를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        "FILE_UPLOAD_CAPACITY_UNAVAILABLE",
      );
    }
    const usage = await getUsageSnapshot(db, session);
    return noStore(NextResponse.json({
      jobId: result.jobId,
      projectNumber: result.projectNumber,
      uploadSessionId: result.uploadSessionId,
      uploadUrl: result.uploadUrl,
      token: result.token,
      expiresAt: result.expiresAt,
      status: capacity.runningCount > 0 ? "ready" : "preparing",
      usage,
    }, { status: result.created ? 201 : 200 }));
  } catch (error) {
    return noStore(apiError(error));
  }
}
