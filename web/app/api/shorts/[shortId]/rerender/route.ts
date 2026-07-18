import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export async function POST(_: Request, context: { params: Promise<{ shortId: string }> }) {
  try {
    const { shortId } = await context.params;
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const rows = await db`
      select s.id, s.status, s.rendered_config_hash,
        md5(concat_ws('|', s.hook_title, s.channel_display_name, s.subtitles_enabled::text,
          s.subtitle_segments::text, s.template_id, s.video_aspect_ratio,
          s.title_font_scale::text)) as current_config_hash
      from shorts_mvp.generated_shorts s
      join shorts_mvp.video_jobs j on j.id=s.job_id
      where s.id=${shortId} and not j.is_example and (
        (${session.userId}::uuid is not null and s.user_id=${session.userId})
        or (${session.userId}::uuid is null and s.user_id is null and s.mvp_session_id=${session.id})
      ) and s.deleted_at is null
        and s.expires_at > now() and s.status in ('ready','rerendering')
        and s.output_s3_key is not null
    `;
    if (!rows[0]) throw new Error("재렌더링할 쇼츠를 찾을 수 없습니다.");
    if (rows[0].status === "rerendering") return NextResponse.json({ status: "rerendering" });
    if (rows[0].renderedConfigHash === rows[0].currentConfigHash) {
      return NextResponse.json({ status: "ready", unchanged: true });
    }
    await db.begin(async (tx) => {
      const updated = await tx`
        update shorts_mvp.generated_shorts s
        set status='rerendering', rerender_progress=5,
          pending_render_hash=md5(concat_ws('|', s.hook_title, s.channel_display_name,
            s.subtitles_enabled::text, s.subtitle_segments::text, s.template_id,
            s.video_aspect_ratio, s.title_font_scale::text))
        from shorts_mvp.video_jobs j
        where s.id=${shortId} and j.id=s.job_id and not j.is_example and (
          (${session.userId}::uuid is not null and s.user_id=${session.userId})
          or (${session.userId}::uuid is null and s.user_id is null and s.mvp_session_id=${session.id})
        )
          and s.status='ready' and s.deleted_at is null and s.expires_at > now()
          and s.rendered_config_hash is distinct from md5(concat_ws('|', s.hook_title,
            s.channel_display_name, s.subtitles_enabled::text, s.subtitle_segments::text,
            s.template_id, s.video_aspect_ratio, s.title_font_scale::text))
        returning s.id
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
