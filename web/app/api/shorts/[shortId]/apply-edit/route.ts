import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { putEditorChannelAsset } from "@/lib/aws";
import { getBillingSummary } from "@/lib/billing";
import {
  captionRenderSpecForEditor,
  parseCaptionRenderSpec,
} from "@/lib/caption-render-spec";
import { templateIds } from "@/lib/contracts";
import { getDb } from "@/lib/db";
import {
  editorDocumentOutputDuration,
  editorDocumentSnapshotSchema,
  type ValidatedEditorDocumentSnapshot,
} from "@/lib/editor-document-contract";
import type { EditorDocumentJsonObject } from "@/lib/editor-document-snapshot";
import {
  createEditorRenderSpec,
  EDITOR_RENDER_SPEC_LEGACY_VERSION,
  EDITOR_RENDER_SPEC_VERSION,
} from "@/lib/editor-render-spec";
import {
  subtitleEditingReleaseEnabled,
  resolveRequestedEditorRelease,
  type EditorReleaseAssignment,
  type RequestedEditorRelease,
} from "@/lib/editor-rendering-release";
import { isStableEditorFontId } from "@/lib/editor-fonts";
import { resolveEditedTemplateSelection } from "@/lib/edit-template-selection";
import { apiError, HttpError } from "@/lib/http";
import {
  clampTimelineSeconds,
  RANGE_EDIT_BOUNDARY_TOLERANCE_SECONDS,
  RANGE_EDIT_MIN_SECONDS,
  rangeEditingEnabled,
  scaleTimedRanges,
  subtitlesForTimelineSelection,
  type TimelineSubtitle,
} from "@/lib/range-editing";
import {
  ONBOARDING_WELCOME_MAX_RERENDERS,
  ONBOARDING_WELCOME_PRODUCT_CODE,
  onboardingWelcomeRerenderAllowed,
} from "@/lib/onboarding-welcome";
import { assertPaidProjectActionAccess } from "@/lib/project-action-entitlements";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import {
  getSubtitleTemplateAccess,
  lockSubtitleTemplateAccess,
} from "@/lib/subtitle-template-release";
import {
  assertUnifiedTemplateSubtitleCanaryAccess,
  isUnifiedTemplateSubtitleSnapshot,
} from "@/lib/template-execution-snapshot";

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const titleTextStyle = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  color: hexColor.optional(),
  backgroundColor: hexColor.optional(),
}).refine((item) => item.end > item.start)
  .refine((item) => Boolean(item.color || item.backgroundColor));
const commentOverlay = z.object({
  id: z.string().uuid(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  text: z.string().trim().min(1).max(200),
  initial: z.string().trim().min(1).max(2),
  avatarColor: hexColor,
  nickname: z.string().trim().min(1).max(30),
  likeCount: z.number().int().min(10).max(999_999),
  ageLabel: z.string().trim().min(1).max(20),
}).refine((item) => item.endSeconds > item.startSeconds);
const activeCommentOverlays = z.array(commentOverlay).max(20);
const subtitle = z.object({
  start: z.number().finite().nonnegative(),
  end: z.number().finite().positive(),
  text: z.string().max(200),
}).refine((item) => item.end > item.start);
const legacyEditSchema = z.object({
  startSeconds: z.number().finite().nonnegative(),
  endSeconds: z.number().finite().positive(),
  hookTitle: z.string().trim().min(1).max(80)
    .refine((value) => value.split("\n").length <= 2),
  channelDisplayName: z.string().trim().min(1).max(50),
  subtitlesEnabled: z.boolean(),
  subtitleSegments: z.array(subtitle).max(500).optional(),
  commentOverlays: z.array(z.unknown()).max(20).default([]),
  templateId: z.enum(templateIds),
  customTemplateId: z.string().uuid().nullable().optional(),
  titleFontScale: z.number().min(0.8).max(1.2).default(1),
  titleTextStyles: z.array(titleTextStyle).max(80).default([]),
}).superRefine((input, context) => {
  if (input.templateId !== "comment-capture") return;
  const comments = activeCommentOverlays.safeParse(input.commentOverlays);
  if (!comments.success) {
    context.addIssue({
      code: "custom",
      path: ["commentOverlays"],
      message: "댓글 내용과 노출 구간을 다시 확인해 주세요.",
    });
  } else if (comments.data.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["commentOverlays"],
      message: "댓글 템플릿에는 댓글을 한 개 이상 추가해 주세요.",
    });
  }
}).transform((input) => ({
  ...input,
  commentOverlays: input.templateId === "comment-capture"
    ? activeCommentOverlays.parse(input.commentOverlays)
    : [],
}));

const editorDocumentRequestSchema = z.object({
  requestId: z.string().uuid(),
  release: z.object({
    releaseId: z.string().uuid(),
    channel: z.enum(["stable", "canary"]),
    uiVersion: z.number().int().min(2),
    documentVersion: z.number().int().min(2),
  }).strict(),
  document: editorDocumentSnapshotSchema,
}).strict();

type EditorExistingRow = {
  id: string;
  jobId: string;
  mvpSessionId: string;
  status: string;
  renderVersion: number;
  durationSeconds: number;
  templateId: (typeof templateIds)[number];
  customTemplateId: string | null;
  templateSnapshot: EditorDocumentJsonObject | null;
  videoAspectRatio: string;
  editTimelineS3Key: string | null;
  editTimelineStartSeconds: number | null;
  editTimelineEndSeconds: number | null;
  cleanClipS3Key: string | null;
  startSeconds: number;
  endSeconds: number;
  subtitleTemplateId: string | null;
  subtitleTemplateSnapshot: unknown;
  captionRenderSpec: unknown;
  subtitlesEnabled: boolean;
  channelThumbnailUrl: string | null;
  editorDocument: ValidatedEditorDocumentSnapshot | null;
  wordTimedSubtitlesAvailable: boolean;
  onboardingWelcomeFunded: boolean;
};

function editorSnapshotHash(document: ValidatedEditorDocumentSnapshot) {
  return createHash("md5").update(JSON.stringify(document)).digest("hex");
}

function sameTimelineSecond(left: number, right: number) {
  return Math.abs(left - right) <= RANGE_EDIT_BOUNDARY_TOLERANCE_SECONDS;
}

function usesCandidateOnlyEditorFont(
  document: ValidatedEditorDocumentSnapshot,
) {
  return [
    document.overlays.fonts.title,
    document.overlays.fonts.channel,
    ...document.overlays.textOverlays.map((overlay) => overlay.fontId),
    ...(document.version === 3
      && document.renderSpec.version !== EDITOR_RENDER_SPEC_LEGACY_VERSION
      ? [document.renderSpec.subtitles.fontId]
      : []),
  ].some((fontId) => fontId != null && !isStableEditorFontId(fontId));
}

async function applyEditorDocument({
  shortId,
  requestId,
  requestedRelease,
  document: requestedDocument,
}: {
  shortId: string;
  requestId: string;
  requestedRelease: RequestedEditorRelease;
  document: ValidatedEditorDocumentSnapshot;
}) {
  const session = await requireAuthenticatedMvpSession();
  const db = getDb();
  const release = await resolveRequestedEditorRelease(
    db,
    session.userId,
    requestedRelease,
  );
  if (release.channel === "legacy" || !release.releaseId) {
    throw new HttpError(404, "새 편집 저장 기능을 찾을 수 없습니다.");
  }
  if (release.documentVersion !== requestedDocument.version) {
    throw new HttpError(
      409,
      "편집기가 업데이트되었습니다. 화면을 새로 연 뒤 다시 저장해 주세요.",
      "EDITOR_RELEASE_VERSION_CONFLICT",
    );
  }
  if (
    requestedDocument.version === 3
    && requestedDocument.renderSpec.version !== EDITOR_RENDER_SPEC_LEGACY_VERSION
    && !subtitleEditingReleaseEnabled(release)
  ) {
    throw new HttpError(
      403,
      "현재 편집기 릴리스에서는 자막 편집을 사용할 수 없습니다.",
      "EDITOR_SUBTITLE_EDITING_DISABLED",
    );
  }
  const billing = await getBillingSummary(db, session.userId);
  assertPaidProjectActionAccess(billing, "edit");
  const requestedClipWindows = requestedDocument.video.clips.map((clip) => ({
    sourceStartSeconds: clip.sourceStartSeconds,
    sourceEndSeconds: clip.sourceEndSeconds,
  }));
  const existingRows = await db`
    select s.id,s.job_id,s.mvp_session_id,s.status,s.render_version,
      s.duration_seconds,s.template_id,s.custom_template_id,s.template_snapshot,
      s.video_aspect_ratio,s.edit_timeline_s3_key,
      s.edit_timeline_start_seconds,s.edit_timeline_end_seconds,
      s.clean_clip_s3_key,s.start_seconds,s.end_seconds,
      s.subtitle_template_id,s.subtitle_template_snapshot,s.caption_render_spec,
      s.subtitles_enabled,s.editor_document,j.channel_thumbnail_url,
      exists (
        select 1
        from shorts_mvp.job_transcripts transcript
        cross join lateral jsonb_array_elements(transcript.words) word
        cross join lateral jsonb_array_elements(
          ${db.json(requestedClipWindows)}::jsonb
        ) clip
        where transcript.job_id=j.id
          and jsonb_array_length(transcript.words)>0
          and not exists (
            select 1
            from jsonb_array_elements(transcript.words) word
            where jsonb_typeof(word->'text') is distinct from 'string'
              or btrim(word->>'text')=''
              or jsonb_typeof(word->'start') is distinct from 'number'
              or jsonb_typeof(word->'end') is distinct from 'number'
              or case
                when jsonb_typeof(word->'start')='number'
                  and jsonb_typeof(word->'end')='number'
                then (word->>'start')::numeric<0
                  or (word->>'end')::numeric<=(word->>'start')::numeric
                else true
              end
          )
          and case
            when jsonb_typeof(word->'start')='number'
              and jsonb_typeof(word->'end')='number'
              and jsonb_typeof(clip->'sourceStartSeconds')='number'
              and jsonb_typeof(clip->'sourceEndSeconds')='number'
            then (word->>'end')::numeric > coalesce(
              s.edit_timeline_start_seconds,
              s.start_seconds
            ) + (clip->>'sourceStartSeconds')::numeric
              and (word->>'start')::numeric < coalesce(
                s.edit_timeline_start_seconds,
                s.start_seconds
              ) + (clip->>'sourceEndSeconds')::numeric
            else false
          end
      ) as word_timed_subtitles_available,
      exists (
        select 1
        from shorts_mvp.usage_reservations reservation
        join shorts_mvp.usage_grant_allocations allocation
          on allocation.reservation_id=reservation.id
        join shorts_mvp.usage_grants grant_row
          on grant_row.id=allocation.grant_id
        where reservation.job_id=j.id
          and grant_row.product_code=${ONBOARDING_WELCOME_PRODUCT_CODE}
      )
      and not exists (
        select 1
        from shorts_mvp.usage_reservations reservation
        join shorts_mvp.usage_grant_allocations allocation
          on allocation.reservation_id=reservation.id
        join shorts_mvp.usage_grants grant_row
          on grant_row.id=allocation.grant_id
        where reservation.job_id=j.id
          and grant_row.product_code<>${ONBOARDING_WELCOME_PRODUCT_CODE}
      ) as onboarding_welcome_funded
    from shorts_mvp.generated_shorts s
    join shorts_mvp.video_jobs j on j.id=s.job_id
    where s.id=${shortId} and not j.is_example
      and j.user_deleted_at is null
      and s.user_id=${session.userId}
      and s.deleted_at is null and s.expires_at>clock_timestamp()
      and s.output_s3_key is not null
      and coalesce(s.edit_timeline_s3_key,s.clean_clip_s3_key) is not null
    limit 1
  `;
  const existing = existingRows[0] as EditorExistingRow | undefined;
  if (!existing) {
    throw new HttpError(404, "편집 가능한 쇼츠 영상을 찾을 수 없습니다.");
  }
  const unifiedTemplateSubtitleOutput = isUnifiedTemplateSubtitleSnapshot(
    existing.subtitleTemplateSnapshot,
  );
  const unifiedSubtitleEditRequested = unifiedTemplateSubtitleOutput || (
    requestedDocument.version === 3
    && requestedDocument.renderSpec.version === EDITOR_RENDER_SPEC_VERSION
  );
  const candidateOnlyFontRequested = usesCandidateOnlyEditorFont(
    requestedDocument,
  );
  if (
    existing.subtitleTemplateId
    && !subtitleEditingReleaseEnabled(release)
  ) {
    throw new HttpError(
      409,
      "자막 템플릿으로 만든 영상은 아직 편집할 수 없습니다.",
      "SUBTITLE_TEMPLATE_EDIT_UNSUPPORTED",
    );
  }
  if (unifiedSubtitleEditRequested || candidateOnlyFontRequested) {
    assertUnifiedTemplateSubtitleCanaryAccess(
      await getSubtitleTemplateAccess(db, session.userId),
    );
  }
  const storedCaptionRenderSpec = existing.subtitleTemplateId
    ? parseCaptionRenderSpec(existing.captionRenderSpec)
    : null;
  const captionRenderSpec = storedCaptionRenderSpec
    ? captionRenderSpecForEditor(storedCaptionRenderSpec)
    : null;
  if (
    captionRenderSpec
    && existing.subtitleTemplateId
    && captionRenderSpec.templateId !== existing.subtitleTemplateId
  ) {
    throw new HttpError(
      409,
      "원본 자막 렌더 정보를 찾을 수 없습니다.",
      "CAPTION_RENDER_SPEC_MISSING",
    );
  }
  if (
    requestedDocument.version === 3
    && requestedDocument.renderSpec.version !== EDITOR_RENDER_SPEC_LEGACY_VERSION
    && requestedDocument.subtitles.enabled
    && !captionRenderSpec
    && !existing.wordTimedSubtitlesAvailable
  ) {
    throw new HttpError(
      409,
      "정확한 단어 타임스탬프가 없는 프로젝트에서는 자막을 편집할 수 없습니다.",
      "EDITOR_WORD_TIMED_SUBTITLES_REQUIRED",
    );
  }
  if (
    requestedDocument.version === 3
    && requestedDocument.renderSpec.version === EDITOR_RENDER_SPEC_VERSION
    && !captionRenderSpec
    && (requestedDocument.renderSpec.subtitles.cueEdits?.length || 0) > 0
  ) {
    throw new HttpError(
      400,
      "정확한 자막 구간이 저장되지 않은 영상에서는 자막 문구를 수정할 수 없습니다.",
      "EDITOR_DYNAMIC_CAPTION_TEXT_EDIT_UNSUPPORTED",
    );
  }
  if (
    requestedDocument.subtitles.enabled
    && !existing.subtitlesEnabled
    && !captionRenderSpec
    && !existing.wordTimedSubtitlesAvailable
  ) {
      throw new HttpError(
        409,
        "유효한 단어 타이밍이 없어 새 자막을 켤 수 없습니다.",
        "EDITOR_WORD_TIMED_SUBTITLES_REQUIRED",
      );
  }
  if (captionRenderSpec) {
    if (
      requestedDocument.version === 3
      && requestedDocument.renderSpec.version !== EDITOR_RENDER_SPEC_LEGACY_VERSION
      && (() => {
        const sourceCueCounts = new Map<number, number>();
        captionRenderSpec.cues.forEach((cue, cueIndex) => {
          const sourceCueIndex = cue.sourceCueIndex ?? cueIndex;
          sourceCueCounts.set(
            sourceCueIndex,
            (sourceCueCounts.get(sourceCueIndex) || 0) + 1,
          );
        });
        return (requestedDocument.renderSpec.subtitles.cueEdits || []).some(
          (edit) => sourceCueCounts.get(edit.cueIndex) !== 1,
        );
      })()
    ) {
      throw new HttpError(
        400,
        "수정할 자막 구간을 다시 선택해 주세요.",
        "EDITOR_CAPTION_CUE_INVALID",
      );
    }
  }
  // Keep the idempotency fingerprint tied to the request the browser sent.
  // The trusted render document is normalized below (for example, an inline
  // channel image becomes an S3 asset key), so hashing the normalized document
  // would make a byte-for-byte retry look like a different request.
  const requestSnapshotHash = editorSnapshotHash(requestedDocument);

  const priorRequestRows = await db`
    select status,base_render_version,snapshot_hash,output_render_version,
      release_id,release_channel
    from shorts_mvp.editor_render_requests
    where id=${requestId} and short_id=${shortId} and user_id=${session.userId}
    limit 1
  `;
  const priorRequest = priorRequestRows[0] as {
    status: string;
    baseRenderVersion: number;
    snapshotHash: string;
    outputRenderVersion: number | null;
    releaseId: string | null;
    releaseChannel: "stable" | "canary" | null;
  } | undefined;
  if (priorRequest) {
    if (
      Number(priorRequest.baseRenderVersion) !== requestedDocument.baseRenderVersion
      || priorRequest.snapshotHash !== requestSnapshotHash
      || priorRequest.releaseId !== release.releaseId
    ) {
      throw new HttpError(
        409,
        "같은 저장 요청 번호를 다른 편집 내용에 사용할 수 없습니다.",
        "EDITOR_REQUEST_CONFLICT",
      );
    }
    if (priorRequest.status === "failed") {
      throw new HttpError(
        409,
        "이 저장 요청은 실패했습니다. 편집 화면을 새로 연 뒤 다시 시도해 주세요.",
        "EDITOR_REQUEST_FAILED",
      );
    }
    return NextResponse.json({
      status: priorRequest.status === "succeeded" ? "ready" : "rerendering",
      renderVersion: priorRequest.outputRenderVersion,
      requestId,
      releaseId: priorRequest.releaseId,
      releaseChannel: priorRequest.releaseChannel,
    }, { status: priorRequest.status === "succeeded" ? 200 : 202 });
  }

  if (existing.status !== "ready") {
    throw new HttpError(409, "이미 수정 반영 중이거나 편집할 수 없는 상태입니다.");
  }
  if (requestedDocument.sourceShortId !== shortId) {
    throw new HttpError(400, "편집 문서의 영상 식별자가 일치하지 않습니다.");
  }
  if (requestedDocument.baseRenderVersion !== Number(existing.renderVersion)) {
    throw new HttpError(
      409,
      "다른 편집 내용이 먼저 반영되었습니다. 편집 화면을 다시 열어 주세요.",
      "EDITOR_RENDER_VERSION_CONFLICT",
    );
  }
  if (!onboardingWelcomeRerenderAllowed(
    Boolean(existing.onboardingWelcomeFunded),
    Number(existing.renderVersion),
  )) {
    throw new HttpError(
      402,
      `무료 체험 프로젝트는 수정 반영을 ${ONBOARDING_WELCOME_MAX_RERENDERS}회까지 할 수 있습니다.`,
      "ONBOARDING_WELCOME_RERENDER_LIMIT",
    );
  }

  const timelineStart = existing.editTimelineS3Key
    ? Number(existing.editTimelineStartSeconds)
    : Number(existing.startSeconds);
  const timelineEnd = existing.editTimelineS3Key
    ? Number(existing.editTimelineEndSeconds)
    : Number(existing.endSeconds);
  if (
    !sameTimelineSecond(requestedDocument.video.timelineStartSeconds, timelineStart)
    || !sameTimelineSecond(requestedDocument.video.timelineEndSeconds, timelineEnd)
  ) {
    throw new HttpError(
      409,
      "편집용 영상 범위가 변경되었습니다. 편집 화면을 다시 열어 주세요.",
      "EDITOR_TIMELINE_CONFLICT",
    );
  }
  if (requestedDocument.video.aspectRatio !== existing.videoAspectRatio) {
    throw new HttpError(400, "편집용 영상의 화면 비율이 일치하지 않습니다.");
  }
  const durationSeconds = editorDocumentOutputDuration(requestedDocument);
  if (requestedDocument.comments.some(
    (comment) => comment.endSeconds > durationSeconds + 0.001,
  )) {
    throw new HttpError(400, "댓글 노출 시간이 최종 영상 길이를 넘을 수 없습니다.");
  }
  if (requestedDocument.overlays.textOverlays.some(
    (overlay) => overlay.endSeconds > durationSeconds + 0.001,
  )) {
    throw new HttpError(400, "텍스트 노출 시간이 최종 영상 길이를 넘을 수 없습니다.");
  }

  const templateSelection = resolveEditedTemplateSelection({
    existing: {
      templateId: existing.templateId,
      customTemplateId: existing.customTemplateId,
      templateSnapshot: existing.templateSnapshot,
    },
    requestedTemplateId: requestedDocument.template.id,
    requestedCustomTemplateId: requestedDocument.template.customTemplateId,
  });
  if (!templateSelection) {
    throw new HttpError(400, "선택한 템플릿을 이 영상에 적용할 수 없습니다.");
  }
  const document: ValidatedEditorDocumentSnapshot = structuredClone(
    requestedDocument,
  );
  document.template.customTemplateId = templateSelection.customTemplateId;
  document.template.snapshot = templateSelection.templateSnapshot
    ? structuredClone(templateSelection.templateSnapshot) as EditorDocumentJsonObject
    : null;
  if (
    templateSelection.customTemplateId === null
    && typeof templateSelection.templateSnapshot?.presetVersion === "number"
  ) {
    document.template.presetVersion =
      templateSelection.templateSnapshot.presetVersion;
  }
  const thumbnailUrl = document.channel.thumbnailUrl;
  if (
    document.channel.thumbnailAssetKey
    && document.channel.thumbnailAssetKey
      !== existing.editorDocument?.channel.thumbnailAssetKey
  ) {
    throw new HttpError(
      400,
      "저장된 채널 이미지를 다시 선택해 주세요.",
      "EDITOR_CHANNEL_ASSET_NOT_TRUSTED",
    );
  }
  if (thumbnailUrl?.startsWith("data:image/")) {
    try {
      document.channel.thumbnailAssetKey = await putEditorChannelAsset({
        sessionId: existing.mvpSessionId,
        jobId: existing.jobId,
        shortId,
        dataUrl: thumbnailUrl,
      });
      document.channel.thumbnailUrl = null;
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : "채널 이미지를 저장하지 못했습니다.",
        "EDITOR_CHANNEL_IMAGE_INVALID",
      );
    }
  } else if (thumbnailUrl) {
    const previousUrl = existing.editorDocument?.channel.thumbnailUrl;
    if (
      !thumbnailUrl.startsWith("https://")
      || (
        thumbnailUrl !== existing.channelThumbnailUrl
        && thumbnailUrl !== previousUrl
      )
    ) {
      throw new HttpError(
        400,
        "직접 추가한 채널 이미지는 다시 선택해 주세요.",
        "EDITOR_CHANNEL_IMAGE_NOT_TRUSTED",
      );
    }
  }
  if (document.version === 3) {
    document.renderSpec = createEditorRenderSpec(document);
  }
  const snapshotHash = editorSnapshotHash(document);
  let persistedRelease = release;
  await db.begin(async (tx) => {
    const lockedRelease: EditorReleaseAssignment =
      await resolveRequestedEditorRelease(
        tx,
        session.userId,
        requestedRelease,
      );
    if (
      lockedRelease.channel === "legacy"
      || !lockedRelease.releaseId
      || lockedRelease.releaseId !== release.releaseId
    ) {
      throw new HttpError(
        409,
        "편집기 릴리스가 변경되었습니다. 화면을 다시 열어 주세요.",
        "EDITOR_RELEASE_CHANGED",
      );
    }
    if (
      existing.subtitleTemplateId
      && !subtitleEditingReleaseEnabled(lockedRelease)
    ) {
      throw new HttpError(
        409,
        "자막 영상의 관리자 편집 권한이 변경되었습니다. 화면을 다시 열어 주세요.",
        "EDITOR_RELEASE_CHANGED",
      );
    }
    if (unifiedSubtitleEditRequested || candidateOnlyFontRequested) {
      assertUnifiedTemplateSubtitleCanaryAccess(
        await lockSubtitleTemplateAccess(tx, session.userId),
      );
    }
    persistedRelease = lockedRelease;
    const insertedRequest = await tx`
      insert into shorts_mvp.editor_render_requests (
        id,short_id,user_id,base_render_version,snapshot_hash,status,
        release_id,release_channel
      ) values (
        ${requestId},${shortId},${session.userId},
        ${document.baseRenderVersion},${requestSnapshotHash},'queued',
        ${lockedRelease.releaseId},${lockedRelease.channel}
      )
      on conflict (id) do nothing
      returning id
    `;
    if (!insertedRequest[0]) {
      throw new HttpError(
        409,
        "같은 저장 요청이 이미 처리되었습니다.",
        "EDITOR_REQUEST_CONFLICT",
      );
    }
    const updated = await tx`
      update shorts_mvp.generated_shorts s
      set status='rerendering',rerender_progress=5,
        pending_edit_snapshot=${tx.json(document)},
        pending_render_hash=${snapshotHash},
        pending_edit_request_id=${requestId},
        rerender_batch_job_id=null,
        render_error_code=null,render_error_message=null
      from shorts_mvp.video_jobs j
      where s.id=${shortId} and j.id=s.job_id and not j.is_example
        and j.user_deleted_at is null
        and s.user_id=${session.userId}
        and s.status='ready'
        and s.render_version=${document.baseRenderVersion}
        and (
          s.subtitle_template_id is null
          or ${subtitleEditingReleaseEnabled(lockedRelease)}
        )
        and s.deleted_at is null and s.expires_at>clock_timestamp()
        and coalesce(s.edit_timeline_s3_key,s.clean_clip_s3_key) is not null
      returning s.id
    `;
    if (!updated[0]) {
      throw new HttpError(
        409,
        "쇼츠 편집 상태가 변경되었습니다. 다시 열어 주세요.",
        "EDITOR_RENDER_VERSION_CONFLICT",
      );
    }
    await tx`
      insert into shorts_mvp.editor_render_outbox (request_id,short_id)
      values (${requestId},${shortId})
    `;
  });
  return NextResponse.json({
    status: "rerendering",
    requestId,
    releaseId: persistedRelease.releaseId,
    releaseChannel: persistedRelease.channel,
  }, { status: 202 });
}

export async function POST(request: Request, context: { params: Promise<{ shortId: string }> }) {
  try {
    const { shortId } = await context.params;
    const requestBody = await request.json();
    if (
      requestBody
      && typeof requestBody === "object"
      && "document" in requestBody
    ) {
      const parsedInput = editorDocumentRequestSchema.safeParse(requestBody);
      if (!parsedInput.success) {
        console.warn(JSON.stringify({
          level: "warning",
          msg: "editor_document_validation_failed",
          shortId,
          issues: parsedInput.error.issues.slice(0, 10).map((issue) => ({
            code: issue.code,
            path: issue.path.map(String).join("."),
          })),
        }));
        throw parsedInput.error;
      }
      const input = parsedInput.data;
      return await applyEditorDocument({
        shortId,
        requestId: input.requestId,
        requestedRelease: input.release,
        document: input.document,
      });
    }
    if (!rangeEditingEnabled()) throw new HttpError(404, "구간 편집 기능을 찾을 수 없습니다.");
    const input = legacyEditSchema.parse(requestBody);
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const billing = await getBillingSummary(db, session.userId);
    assertPaidProjectActionAccess(billing, "edit");
    const existingRows = await db`
      select s.id,s.status,s.render_version,s.duration_seconds,
          s.template_id,s.custom_template_id,
          s.template_snapshot, s.video_aspect_ratio, s.edit_timeline_s3_key,
          s.edit_timeline_start_seconds, s.edit_timeline_end_seconds,
          s.edit_timeline_subtitle_segments, s.clean_clip_s3_key,
          s.start_seconds,s.end_seconds,s.subtitle_segments,
          s.subtitle_template_id,
          exists (
            select 1
            from shorts_mvp.usage_reservations reservation
            join shorts_mvp.usage_grant_allocations allocation
              on allocation.reservation_id=reservation.id
            join shorts_mvp.usage_grants grant_row
              on grant_row.id=allocation.grant_id
            where reservation.job_id=j.id
              and grant_row.product_code=${ONBOARDING_WELCOME_PRODUCT_CODE}
          )
          and not exists (
            select 1
            from shorts_mvp.usage_reservations reservation
            join shorts_mvp.usage_grant_allocations allocation
              on allocation.reservation_id=reservation.id
            join shorts_mvp.usage_grants grant_row
              on grant_row.id=allocation.grant_id
            where reservation.job_id=j.id
              and grant_row.product_code<>${ONBOARDING_WELCOME_PRODUCT_CODE}
          ) as onboarding_welcome_funded
      from shorts_mvp.generated_shorts s
      join shorts_mvp.video_jobs j on j.id=s.job_id
      where s.id=${shortId} and not j.is_example
        and j.user_deleted_at is null and (
        (${session.userId}::uuid is not null and s.user_id=${session.userId})
        or (${session.userId}::uuid is null and s.user_id is null and s.mvp_session_id=${session.id})
      ) and s.deleted_at is null and s.expires_at > now()
        and s.output_s3_key is not null
        and coalesce(s.edit_timeline_s3_key,s.clean_clip_s3_key) is not null
    `;
    const existing = existingRows[0];
    if (!existing) throw new HttpError(404, "편집 가능한 쇼츠 영상을 찾을 수 없습니다.");
    if (existing.subtitleTemplateId) {
      throw new HttpError(
        409,
        "자막 템플릿으로 만든 영상은 아직 편집할 수 없습니다.",
        "SUBTITLE_TEMPLATE_EDIT_UNSUPPORTED",
      );
    }
    if (existing.status !== "ready") {
      throw new HttpError(409, "이미 수정 반영 중이거나 편집할 수 없는 상태입니다.");
    }
    if (!onboardingWelcomeRerenderAllowed(
      Boolean(existing.onboardingWelcomeFunded),
      Number(existing.renderVersion),
    )) {
      throw new HttpError(
        402,
        `무료 체험 프로젝트는 수정 반영을 ${ONBOARDING_WELCOME_MAX_RERENDERS}회까지 할 수 있습니다.`,
        "ONBOARDING_WELCOME_RERENDER_LIMIT",
      );
    }

    const hasCapturedTimeline = Boolean(existing.editTimelineS3Key);
    const timelineStart = hasCapturedTimeline
      ? Number(existing.editTimelineStartSeconds)
      : Number(existing.startSeconds);
    const timelineEnd = hasCapturedTimeline
      ? Number(existing.editTimelineEndSeconds)
      : Number(existing.endSeconds);
    if (
      input.startSeconds < timelineStart - RANGE_EDIT_BOUNDARY_TOLERANCE_SECONDS
      || input.endSeconds > timelineEnd + RANGE_EDIT_BOUNDARY_TOLERANCE_SECONDS
    ) {
      console.warn(JSON.stringify({
        level: "warning",
        msg: "apply_edit_range_outside_timeline",
        shortId,
        requestedStartSeconds: input.startSeconds,
        requestedEndSeconds: input.endSeconds,
        timelineStartSeconds: timelineStart,
        timelineEndSeconds: timelineEnd,
      }));
      throw new HttpError(400, "편집용 영상의 범위 안에서 구간을 선택해 주세요.");
    }
    const selectionStartSeconds = clampTimelineSeconds(
      input.startSeconds,
      timelineStart,
      timelineEnd,
    );
    const selectionEndSeconds = clampTimelineSeconds(
      input.endSeconds,
      timelineStart,
      timelineEnd,
    );
    const durationSeconds = Math.round(
      (selectionEndSeconds - selectionStartSeconds) * 1_000,
    ) / 1_000;
    if (durationSeconds < RANGE_EDIT_MIN_SECONDS) {
      throw new HttpError(400, `최종 영상은 ${RANGE_EDIT_MIN_SECONDS}초 이상이어야 합니다.`);
    }

    const titleLength = Array.from(input.hookTitle).length;
    const orderedTitleStyles = [...input.titleTextStyles].sort((left, right) => left.start - right.start);
    if (orderedTitleStyles.some((style) => style.end > titleLength)) {
      throw new HttpError(400, "제목 스타일 범위가 제목 길이를 넘을 수 없습니다.");
    }
    if (orderedTitleStyles.some((style, index) => index > 0 && style.start < orderedTitleStyles[index - 1].end)) {
      throw new HttpError(400, "제목 스타일 범위가 서로 겹치지 않게 지정해 주세요.");
    }

    const comments = scaleTimedRanges(
      [...input.commentOverlays].sort((left, right) => left.startSeconds - right.startSeconds),
      Number(existing.durationSeconds),
      durationSeconds,
    );
    if (comments.some((comment) => comment.endSeconds > durationSeconds + 0.001)) {
      throw new HttpError(400, "댓글 노출 시간이 최종 영상 길이를 넘을 수 없습니다.");
    }
    if (comments.some((comment, index) => index > 0 && comment.startSeconds < comments[index - 1].endSeconds - 0.001)) {
      throw new HttpError(400, "댓글 노출 시간이 서로 겹치지 않게 조정해 주세요.");
    }

    const storedTimelineSubtitles = (
      hasCapturedTimeline
        ? existing.editTimelineSubtitleSegments || []
        : existing.subtitleSegments || []
    ) as TimelineSubtitle[];
    const requestedTimelineSubtitles = input.subtitleSegments
      || storedTimelineSubtitles;
    if (
      requestedTimelineSubtitles.length !== storedTimelineSubtitles.length
      || storedTimelineSubtitles.some((segment, index) => (
        Math.abs(
          Number(segment.start)
          - requestedTimelineSubtitles[index].start,
        ) > 0.001
        || Math.abs(
          Number(segment.end)
          - requestedTimelineSubtitles[index].end,
        ) > 0.001
      ))
    ) {
      throw new HttpError(400, "자막 시간은 변경할 수 없습니다.");
    }
    const subtitleSegments = subtitlesForTimelineSelection(
      requestedTimelineSubtitles,
      timelineStart,
      selectionStartSeconds,
      selectionEndSeconds,
    );
    const templateSelection = resolveEditedTemplateSelection({
      existing: {
        templateId: existing.templateId,
        customTemplateId: existing.customTemplateId || null,
        templateSnapshot: existing.templateSnapshot || null,
      },
      requestedTemplateId: input.templateId,
      requestedCustomTemplateId: input.customTemplateId,
    });
    if (!templateSelection) {
      throw new HttpError(400, "선택한 템플릿을 이 영상에 적용할 수 없습니다.");
    }
    const snapshot = {
      startSeconds: selectionStartSeconds,
      endSeconds: selectionEndSeconds,
      durationSeconds,
      hookTitle: input.hookTitle,
      channelDisplayName: input.channelDisplayName,
      subtitlesEnabled: input.subtitlesEnabled,
      subtitleSegments,
      timelineSubtitleSegments: requestedTimelineSubtitles,
      commentOverlays: comments,
      templateId: input.templateId,
      customTemplateId: templateSelection.customTemplateId,
      templateSnapshot: templateSelection.templateSnapshot,
      videoAspectRatio: existing.videoAspectRatio || "1:1",
      titleFontScale: input.titleFontScale,
      titleTextStyles: orderedTitleStyles,
      titleTextStylesInitialized: true,
    };
    const snapshotJson = JSON.stringify(snapshot);
    await db.begin(async (tx) => {
      const updated = await tx`
        update shorts_mvp.generated_shorts s
        set status='rerendering', rerender_progress=5,
          pending_edit_snapshot=${tx.json(snapshot)},
          pending_render_hash=md5(${snapshotJson}::jsonb::text),
          rerender_batch_job_id=null, render_error_code=null, render_error_message=null
        from shorts_mvp.video_jobs j
        where s.id=${shortId} and j.id=s.job_id and not j.is_example
          and j.user_deleted_at is null and (
          (${session.userId}::uuid is not null and s.user_id=${session.userId})
          or (${session.userId}::uuid is null and s.user_id is null and s.mvp_session_id=${session.id})
        ) and s.status='ready' and s.deleted_at is null and s.expires_at > now()
          and s.subtitle_template_id is null
          and coalesce(s.edit_timeline_s3_key,s.clean_clip_s3_key) is not null
          and (
            not (
              exists (
                select 1
                from shorts_mvp.usage_reservations reservation
                join shorts_mvp.usage_grant_allocations allocation
                  on allocation.reservation_id=reservation.id
                join shorts_mvp.usage_grants grant_row
                  on grant_row.id=allocation.grant_id
                where reservation.job_id=j.id
                  and grant_row.product_code=${ONBOARDING_WELCOME_PRODUCT_CODE}
              )
              and not exists (
                select 1
                from shorts_mvp.usage_reservations reservation
                join shorts_mvp.usage_grant_allocations allocation
                  on allocation.reservation_id=reservation.id
                join shorts_mvp.usage_grants grant_row
                  on grant_row.id=allocation.grant_id
                where reservation.job_id=j.id
                  and grant_row.product_code<>${ONBOARDING_WELCOME_PRODUCT_CODE}
              )
            )
            or s.render_version<${1 + ONBOARDING_WELCOME_MAX_RERENDERS}
          )
        returning s.id
      `;
      if (!updated[0]) throw new HttpError(409, "쇼츠 편집 상태가 변경되었습니다. 다시 열어 주세요.");
      await tx`
        insert into shorts_mvp.short_outbox (short_id)
        values (${shortId})
        on conflict (short_id) do update set status='pending', available_at=now(),
          dispatched_at=null, last_error=null
      `;
    });
    return NextResponse.json({ status: "rerendering" }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
