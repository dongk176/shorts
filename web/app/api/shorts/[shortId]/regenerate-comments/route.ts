import { NextResponse } from "next/server";
import { z } from "zod";
import { getBillingSummary } from "@/lib/billing";
import {
  generateCommentsWithGemini,
  paidGeminiCommentGenerationEnabled,
} from "@/lib/comment-regeneration-server";
import { getDb } from "@/lib/db";
import { editorOverlayPreviewEnabled } from "@/lib/editor-overlay-preview-flag";
import { editorRenderingV2Enabled } from "@/lib/editor-rendering-release";
import { apiError, HttpError } from "@/lib/http";
import { assertProjectActionAccess } from "@/lib/project-action-entitlements";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { getUsageSnapshot } from "@/lib/usage";

export const maxDuration = 60;

const COMMENT_REGENERATION_USAGE_SECONDS = 60;
const requestSchema = z.object({
  requestId: z.string().uuid(),
  commentCount: z.number().int().min(1).max(20),
});

type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

function usageReservationError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/시간이 부족|사용 가능한|활성 구독|체험시간/.test(message)) {
    return new HttpError(
      402,
      "댓글 재생성에 사용할 수 있는 시간이 부족합니다.",
      "COMMENT_REGENERATION_USAGE_REQUIRED",
    );
  }
  if (/이미 처리 중/.test(message)) {
    return new HttpError(
      409,
      "댓글 재생성이 이미 진행 중입니다.",
      "COMMENT_REGENERATION_IN_PROGRESS",
    );
  }
  return error;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ shortId: string }> },
) {
  let reservationId: string | null = null;
  try {
    const { shortId } = await context.params;
    const input = requestSchema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    if (
      !editorOverlayPreviewEnabled()
      && !await editorRenderingV2Enabled(db, session.userId)
    ) {
      throw new HttpError(404, "댓글 재생성 기능을 찾을 수 없습니다.");
    }
    if (!paidGeminiCommentGenerationEnabled()) {
      throw new HttpError(
        503,
        "유료 Gemini 댓글 생성 설정을 확인해 주세요.",
        "PAID_GEMINI_NOT_CONFIGURED",
      );
    }
    await db`
      update shorts_mvp.ai_comment_regeneration_requests
      set status='released',failure_code='stale_request'
      where user_id=${session.userId}
        and status='reserved'
        and created_at<clock_timestamp()-interval '5 minutes'
    `;
    const [billing, shortRows, usageBefore] = await Promise.all([
      getBillingSummary(db, session.userId),
      db`
        select
          generated_short.id,
          generated_short.hook_title,
          generated_short.highlight_reason,
          generated_short.subtitle_segments,
          generated_short.status
        from shorts_mvp.generated_shorts generated_short
        join shorts_mvp.video_jobs job on job.id=generated_short.job_id
        where generated_short.id=${shortId}
          and generated_short.user_id=${session.userId}
          and not job.is_example
          and generated_short.deleted_at is null
          and generated_short.expires_at>clock_timestamp()
          and generated_short.status='ready'
        limit 1
      `,
      getUsageSnapshot(db, session),
    ]);
    await assertProjectActionAccess(db, billing, session.userId, "edit");
    const generatedShort = shortRows[0] as {
      id: string;
      hookTitle: string;
      highlightReason: string | null;
      subtitleSegments: TranscriptSegment[];
      status: string;
    } | undefined;
    if (!generatedShort) {
      throw new HttpError(
        404,
        "댓글을 재생성할 수 있는 쇼츠를 찾을 수 없습니다.",
        "EDITABLE_SHORT_NOT_FOUND",
      );
    }

    if (usageBefore.remainingSeconds < COMMENT_REGENERATION_USAGE_SECONDS) {
      throw new HttpError(
        402,
        "댓글 재생성에 사용할 수 있는 시간이 부족합니다.",
        "COMMENT_REGENERATION_USAGE_REQUIRED",
      );
    }

    let reservationRows;
    try {
      reservationRows = await db`
        select shorts_mvp.reserve_ai_comment_regeneration_usage(
          ${session.userId},
          ${session.id},
          ${shortId},
          ${input.requestId},
          ${input.commentCount}
        ) as reservation_id
      `;
    } catch (error) {
      throw usageReservationError(error);
    }
    reservationId = String(reservationRows[0]?.reservationId || "");
    if (!reservationId) throw new Error("댓글 재생성 사용량을 예약하지 못했습니다.");

    const existingRows = await db`
      select status,generated_comments
      from shorts_mvp.ai_comment_regeneration_requests
      where id=${reservationId} and user_id=${session.userId}
      limit 1
    `;
    const existing = existingRows[0] as {
      status: string;
      generatedComments: unknown;
    } | undefined;
    if (
      existing?.status === "consumed"
      && Array.isArray(existing.generatedComments)
      && existing.generatedComments.length === input.commentCount
    ) {
      return NextResponse.json({
        comments: existing.generatedComments,
        usage: await getUsageSnapshot(db, session),
      });
    }

    let comments: string[];
    try {
      comments = await generateCommentsWithGemini({
        title: generatedShort.hookTitle,
        highlightReason: generatedShort.highlightReason || "",
        transcript: Array.isArray(generatedShort.subtitleSegments)
          ? generatedShort.subtitleSegments
          : [],
        targetCount: input.commentCount,
      });
    } catch {
      await db`
        update shorts_mvp.ai_comment_regeneration_requests
        set status='released',failure_code='gemini_generation_failed'
        where id=${reservationId} and user_id=${session.userId}
          and status='reserved'
      `;
      reservationId = null;
      throw new HttpError(
        503,
        "AI 댓글을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        "COMMENT_REGENERATION_FAILED",
      );
    }

    const finalized = await db`
      update shorts_mvp.ai_comment_regeneration_requests
      set generated_comments=${db.json(comments)},status='consumed',
        failure_code=null
      where id=${reservationId} and user_id=${session.userId}
        and status='reserved'
      returning id
    `;
    if (!finalized[0]) {
      throw new Error("댓글 재생성 사용량을 확정하지 못했습니다.");
    }
    reservationId = null;
    return NextResponse.json({
      comments,
      usage: await getUsageSnapshot(db, session),
    });
  } catch (error) {
    if (reservationId) {
      const db = getDb();
      await db`
        update shorts_mvp.ai_comment_regeneration_requests
        set status='released',failure_code='request_failed'
        where id=${reservationId} and status='reserved'
      `.catch(() => undefined);
    }
    return apiError(error, "댓글을 재생성하지 못했습니다.");
  }
}
