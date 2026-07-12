import { NextResponse } from "next/server";
import { submitRerender } from "@/lib/aws";
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
          subtitle_segments::text, template_id, title_font_scale::text)) as current_config_hash
      from shorts_mvp.generated_shorts
      where id=${shortId} and mvp_session_id=${session.id} and deleted_at is null and expires_at > now()
    `;
    if (!rows[0]) throw new Error("재렌더링할 쇼츠를 찾을 수 없습니다.");
    if (rows[0].status === "rerendering") return NextResponse.json({ status: "rerendering" });
    if (rows[0].renderedConfigHash === rows[0].currentConfigHash) {
      return NextResponse.json({ status: "ready", unchanged: true });
    }
    await db`
      update shorts_mvp.generated_shorts
      set status='rerendering', rerender_progress=5,
        pending_render_hash=${rows[0].currentConfigHash}
      where id=${shortId}
    `;
    try {
      const batchJobId = await submitRerender(shortId);
      await db`
        update shorts_mvp.generated_shorts set rerender_batch_job_id=${batchJobId}
        where id=${shortId} and status='rerendering'
      `;
      return NextResponse.json({ status: "rerendering", batchJobId }, { status: 202 });
    } catch (error) {
      await db`
        update shorts_mvp.generated_shorts
        set status='ready', rerender_progress=0,
          pending_render_hash=null, rerender_batch_job_id=null
        where id=${shortId}
      `;
      throw error;
    }
  } catch (error) { return apiError(error); }
}
