import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { requireMvpSession } from "@/lib/session";

export async function POST(_: Request, context: { params: Promise<{ shortId: string }> }) {
  try {
    const { shortId } = await context.params;
    const session = await requireMvpSession();
    const db = getDb();
    const rows = await db`
      select id, status, rendered_config_hash,
        md5(concat_ws('|', hook_title, channel_display_name, subtitles_enabled::text,
          subtitle_segments::text, template_id, video_aspect_ratio,
          title_font_scale::text)) as current_config_hash
      from shorts_mvp.generated_shorts
      where id=${shortId} and mvp_session_id=${session.id} and deleted_at is null
        and expires_at > now() and status in ('ready','rerendering')
        and output_s3_key is not null
    `;
    if (!rows[0]) throw new Error("재렌더링할 쇼츠를 찾을 수 없습니다.");
    if (rows[0].status === "rerendering") return NextResponse.json({ status: "rerendering" });
    if (rows[0].renderedConfigHash === rows[0].currentConfigHash) {
      return NextResponse.json({ status: "ready", unchanged: true });
    }
    await db.begin(async (tx) => {
      const updated = await tx`
        update shorts_mvp.generated_shorts
        set status='rerendering', rerender_progress=5,
          pending_render_hash=md5(concat_ws('|', hook_title, channel_display_name,
            subtitles_enabled::text, subtitle_segments::text, template_id,
            video_aspect_ratio, title_font_scale::text))
        where id=${shortId} and mvp_session_id=${session.id}
          and status='ready' and deleted_at is null and expires_at > now()
          and rendered_config_hash is distinct from md5(concat_ws('|', hook_title,
            channel_display_name, subtitles_enabled::text, subtitle_segments::text,
            template_id, video_aspect_ratio, title_font_scale::text))
        returning id
      `;
      if (!updated[0]) throw new Error("재렌더링할 쇼츠 상태가 변경되었습니다.");
      await tx`
        insert into shorts_mvp.short_outbox (short_id)
        values (${shortId})
        on conflict (short_id) do update set status='pending', available_at=now(),
          dispatched_at=null, last_error=null
      `;
    });
    return NextResponse.json({ status: "rerendering" }, { status: 202 });
  } catch (error) { return apiError(error); }
}
