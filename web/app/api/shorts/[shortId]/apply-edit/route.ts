import { NextResponse } from "next/server";
import { z } from "zod";
import { templateIds } from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import {
  RANGE_EDIT_MIN_SECONDS,
  rangeEditingEnabled,
  scaleTimedRanges,
  subtitlesForTimelineSelection,
  type TimelineSubtitle,
} from "@/lib/range-editing";
import { requireAuthenticatedMvpSession } from "@/lib/session";

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
const editSchema = z.object({
  startSeconds: z.number().finite().nonnegative(),
  endSeconds: z.number().finite().positive(),
  hookTitle: z.string().trim().min(1).max(80)
    .refine((value) => value.split("\n").length <= 2),
  channelDisplayName: z.string().trim().min(1).max(50),
  subtitlesEnabled: z.boolean(),
  commentOverlays: z.array(commentOverlay).max(20).default([]),
  templateId: z.enum(templateIds),
  titleFontScale: z.number().min(0.8).max(1.2).default(1),
  titleTextStyles: z.array(titleTextStyle).max(80).default([]),
});

export async function POST(request: Request, context: { params: Promise<{ shortId: string }> }) {
  try {
    if (!rangeEditingEnabled()) throw new HttpError(404, "구간 편집 기능을 찾을 수 없습니다.");
    const { shortId } = await context.params;
    const input = editSchema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const existingRows = await db`
      select s.id, s.status, s.duration_seconds, s.template_id, s.custom_template_id,
        s.template_snapshot, s.video_aspect_ratio, s.edit_timeline_s3_key,
        s.edit_timeline_start_seconds, s.edit_timeline_end_seconds,
        s.edit_timeline_subtitle_segments
      from shorts_mvp.generated_shorts s
      join shorts_mvp.video_jobs j on j.id=s.job_id
      where s.id=${shortId} and not j.is_example and (
        (${session.userId}::uuid is not null and s.user_id=${session.userId})
        or (${session.userId}::uuid is null and s.user_id is null and s.mvp_session_id=${session.id})
      ) and s.deleted_at is null and s.expires_at > now()
        and s.output_s3_key is not null and s.edit_timeline_s3_key is not null
    `;
    const existing = existingRows[0];
    if (!existing) throw new HttpError(404, "편집할 쇼츠 또는 여유 영상을 찾을 수 없습니다.");
    if (existing.status !== "ready") {
      throw new HttpError(409, "이미 수정 반영 중이거나 편집할 수 없는 상태입니다.");
    }

    const timelineStart = Number(existing.editTimelineStartSeconds);
    const timelineEnd = Number(existing.editTimelineEndSeconds);
    const durationSeconds = Math.round((input.endSeconds - input.startSeconds) * 1_000) / 1_000;
    if (durationSeconds < RANGE_EDIT_MIN_SECONDS) {
      throw new HttpError(400, `최종 영상은 ${RANGE_EDIT_MIN_SECONDS}초 이상이어야 합니다.`);
    }
    if (input.startSeconds < timelineStart - 0.001 || input.endSeconds > timelineEnd + 0.001) {
      throw new HttpError(400, "편집용 영상의 범위 안에서 구간을 선택해 주세요.");
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

    const subtitleSegments = subtitlesForTimelineSelection(
      (existing.editTimelineSubtitleSegments || []) as TimelineSubtitle[],
      timelineStart,
      input.startSeconds,
      input.endSeconds,
    );
    const snapshot = {
      startSeconds: Math.round(input.startSeconds * 1_000) / 1_000,
      endSeconds: Math.round(input.endSeconds * 1_000) / 1_000,
      durationSeconds,
      hookTitle: input.hookTitle,
      channelDisplayName: input.channelDisplayName,
      subtitlesEnabled: input.subtitlesEnabled,
      subtitleSegments,
      commentOverlays: comments,
      templateId: input.templateId,
      customTemplateId: existing.templateId === input.templateId ? existing.customTemplateId || null : null,
      templateSnapshot: existing.templateId === input.templateId ? existing.templateSnapshot || null : null,
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
        where s.id=${shortId} and j.id=s.job_id and not j.is_example and (
          (${session.userId}::uuid is not null and s.user_id=${session.userId})
          or (${session.userId}::uuid is null and s.user_id is null and s.mvp_session_id=${session.id})
        ) and s.status='ready' and s.deleted_at is null and s.expires_at > now()
          and s.edit_timeline_s3_key is not null
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
