import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteShortObjects } from "@/lib/aws";
import { templateIds } from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";

const subtitle = z.object({ start: z.number().nonnegative(), end: z.number().positive(), text: z.string().max(200) }).refine((item) => item.end > item.start);
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const titleTextStyle = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  color: hexColor.optional(),
  backgroundColor: hexColor.optional(),
}).refine((item) => item.end > item.start, "제목 스타일 종료 위치는 시작 위치보다 뒤여야 합니다.")
  .refine((item) => Boolean(item.color || item.backgroundColor), "제목 스타일 색상을 선택해 주세요.");
const commentOverlay = z.object({
  id: z.string().uuid(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  text: z.string().trim().min(1).max(200),
  initial: z.string().trim().min(1).max(2),
  avatarColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  nickname: z.string().trim().min(1).max(30),
  likeCount: z.number().int().min(10).max(999_999),
  ageLabel: z.string().trim().min(1).max(20),
}).refine((item) => item.endSeconds > item.startSeconds, "댓글 종료 시간은 시작 시간보다 뒤여야 합니다.");
const patchSchema = z.object({
  hookTitle: z.string().trim().min(1).max(80).refine((value) => value.split("\n").length <= 2, "제목은 최대 2줄입니다."),
  channelDisplayName: z.string().trim().min(1).max(50),
  subtitlesEnabled: z.boolean(),
  subtitleSegments: z.array(subtitle).max(500),
  commentOverlays: z.array(commentOverlay).max(20).default([]),
  templateId: z.enum(templateIds),
  titleFontScale: z.number().min(0.8).max(1.2).default(1),
  titleTextStyles: z.array(titleTextStyle).max(80).default([]),
}).superRefine((input, context) => {
  if (input.templateId === "comment-capture" && input.commentOverlays.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["commentOverlays"],
      message: "댓글 템플릿에는 댓글을 한 개 이상 추가해 주세요.",
    });
  }
});

export async function PATCH(request: Request, context: { params: Promise<{ shortId: string }> }) {
  try {
    const { shortId } = await context.params;
    const input = patchSchema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const existing = await db`
      select s.id, s.subtitle_segments, s.duration_seconds, s.template_id from shorts_mvp.generated_shorts s
      join shorts_mvp.video_jobs j on j.id=s.job_id
      where s.id=${shortId} and not j.is_example and (
        (${session.userId}::uuid is not null and s.user_id=${session.userId})
        or (${session.userId}::uuid is null and s.user_id is null and s.mvp_session_id=${session.id})
      )
        and s.deleted_at is null and s.expires_at > now()
        and s.status='ready' and s.output_s3_key is not null
    `;
    if (!existing[0]) throw new Error("편집할 쇼츠를 찾을 수 없습니다.");
    const titleLength = Array.from(input.hookTitle).length;
    const orderedTitleStyles = [...input.titleTextStyles].sort((left, right) => left.start - right.start);
    if (orderedTitleStyles.some((style) => style.end > titleLength)) {
      throw new Error("제목 스타일 범위가 제목 길이를 넘을 수 없습니다.");
    }
    if (orderedTitleStyles.some((style, index) => index > 0 && style.start < orderedTitleStyles[index - 1].end)) {
      throw new Error("제목 스타일 범위가 서로 겹치지 않게 지정해 주세요.");
    }
    const timestamps = existing[0].subtitleSegments as Array<{ start: number; end: number }>;
    if (
      timestamps.length !== input.subtitleSegments.length
      || timestamps.some((segment, index) =>
        Math.abs(Number(segment.start) - input.subtitleSegments[index].start) > 0.001
        || Math.abs(Number(segment.end) - input.subtitleSegments[index].end) > 0.001
      )
    ) {
      throw new Error("MVP에서는 자막 시간은 변경할 수 없습니다.");
    }
    const durationSeconds = Number(existing[0].durationSeconds);
    const orderedComments = [...input.commentOverlays].sort((left, right) => left.startSeconds - right.startSeconds);
    if (orderedComments.some((comment) => comment.endSeconds > durationSeconds + 0.001)) {
      throw new Error("댓글 노출 시간은 쇼츠 길이를 넘을 수 없습니다.");
    }
    if (orderedComments.some((comment, index) => index > 0 && comment.startSeconds < orderedComments[index - 1].endSeconds - 0.001)) {
      throw new Error("댓글 노출 시간이 서로 겹치지 않게 조정해 주세요.");
    }
    const rows = await db`
      update shorts_mvp.generated_shorts s set
        hook_title=${input.hookTitle}, channel_display_name=${input.channelDisplayName},
        subtitles_enabled=${input.subtitlesEnabled}, subtitle_segments=${db.json(input.subtitleSegments)},
        comment_overlays=${db.json(input.commentOverlays)},
        custom_template_id=case when s.template_id=${input.templateId} then s.custom_template_id else null end,
        template_snapshot=case when s.template_id=${input.templateId} then s.template_snapshot else null end,
        template_id=${input.templateId}, title_font_scale=${input.titleFontScale},
        title_text_styles=${db.json(orderedTitleStyles)}, title_text_styles_initialized=true
      from shorts_mvp.video_jobs j
      where s.id=${shortId} and j.id=s.job_id and not j.is_example and (
        (${session.userId}::uuid is not null and s.user_id=${session.userId})
        or (${session.userId}::uuid is null and s.user_id is null and s.mvp_session_id=${session.id})
      ) and s.deleted_at is null and s.expires_at > now()
        and s.status='ready' and s.output_s3_key is not null
      returning s.id, s.render_version
    `;
    if (!rows[0]) throw new Error("편집할 쇼츠를 찾을 수 없습니다.");
    return NextResponse.json({ id: rows[0].id, renderVersion: rows[0].renderVersion, saved: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE(_: Request, context: { params: Promise<{ shortId: string }> }) {
  try {
    const { shortId } = await context.params;
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const rows = await db`
      update shorts_mvp.generated_shorts s
      set status='deleted', deleted_at=coalesce(deleted_at, now())
      from shorts_mvp.video_jobs j
      where s.id=${shortId} and j.id=s.job_id and not j.is_example and (
        (${session.userId}::uuid is not null and s.user_id=${session.userId})
        or (${session.userId}::uuid is null and s.user_id is null and s.mvp_session_id=${session.id})
      )
        and (s.status='deleted' or (s.deleted_at is null and s.status in ('ready','rerendering')))
      returning s.id, s.output_s3_key, s.clean_clip_s3_key,
        s.edit_timeline_s3_key, s.thumbnail_s3_key
    `;
    if (!rows[0]) throw new Error("삭제할 쇼츠를 찾을 수 없습니다.");
    await deleteShortObjects([
      rows[0].outputS3Key,
      rows[0].cleanClipS3Key,
      rows[0].editTimelineS3Key,
      rows[0].thumbnailS3Key,
    ].filter(Boolean));
    return NextResponse.json({ deleted: true });
  } catch (error) { return apiError(error); }
}
