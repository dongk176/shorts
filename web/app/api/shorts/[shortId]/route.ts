import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteShortObjects } from "@/lib/aws";
import { templateIds } from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { requireMvpSession } from "@/lib/session";

const subtitle = z.object({ start: z.number().nonnegative(), end: z.number().positive(), text: z.string().max(200) }).refine((item) => item.end > item.start);
const patchSchema = z.object({
  hookTitle: z.string().trim().min(1).max(80).refine((value) => value.split("\n").length <= 2, "제목은 최대 2줄입니다."),
  channelDisplayName: z.string().trim().min(1).max(50),
  subtitlesEnabled: z.boolean(),
  subtitleSegments: z.array(subtitle).max(500),
  templateId: z.enum(templateIds),
  titleFontScale: z.number().min(0.8).max(1.2).default(1),
});

export async function PATCH(request: Request, context: { params: Promise<{ shortId: string }> }) {
  try {
    const { shortId } = await context.params;
    const input = patchSchema.parse(await request.json());
    const session = await requireMvpSession();
    const db = getDb();
    const existing = await db`
      select id, subtitle_segments from shorts_mvp.generated_shorts
      where id=${shortId} and mvp_session_id=${session.id}
        and deleted_at is null and expires_at > now()
    `;
    if (!existing[0]) throw new Error("편집할 쇼츠를 찾을 수 없습니다.");
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
    const rows = await db`
      update shorts_mvp.generated_shorts set
        hook_title=${input.hookTitle}, channel_display_name=${input.channelDisplayName},
        subtitles_enabled=${input.subtitlesEnabled}, subtitle_segments=${db.json(input.subtitleSegments)},
        template_id=${input.templateId}, title_font_scale=${input.titleFontScale}
      where id=${shortId} and mvp_session_id=${session.id} and deleted_at is null and expires_at > now()
      returning id, render_version
    `;
    if (!rows[0]) throw new Error("편집할 쇼츠를 찾을 수 없습니다.");
    return NextResponse.json({ id: rows[0].id, renderVersion: rows[0].renderVersion, saved: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE(_: Request, context: { params: Promise<{ shortId: string }> }) {
  try {
    const { shortId } = await context.params;
    const session = await requireMvpSession();
    const db = getDb();
    const rows = await db`
      select id, output_s3_key, clean_clip_s3_key, thumbnail_s3_key
      from shorts_mvp.generated_shorts
      where id=${shortId} and mvp_session_id=${session.id} and deleted_at is null
    `;
    if (!rows[0]) throw new Error("삭제할 쇼츠를 찾을 수 없습니다.");
    await deleteShortObjects([rows[0].outputS3Key, rows[0].cleanClipS3Key, rows[0].thumbnailS3Key].filter(Boolean));
    await db`update shorts_mvp.generated_shorts set status='deleted', deleted_at=now() where id=${shortId}`;
    return NextResponse.json({ deleted: true });
  } catch (error) { return apiError(error); }
}
