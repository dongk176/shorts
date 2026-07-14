import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/http";
import { getDb } from "@/lib/db";
import { requireMvpSession } from "@/lib/session";
import { analyzeYoutubeUrl } from "@/lib/youtube";

const schema = z.object({ youtubeUrl: z.string().min(1).max(2048) });

export async function POST(request: Request) {
  try {
    const session = await requireMvpSession();
    const body = schema.parse(await request.json());
    const analysis = await analyzeYoutubeUrl(body.youtubeUrl);
    const rows = await getDb()`
      insert into shorts_mvp.youtube_analyses (
        mvp_session_id, user_id, youtube_url, youtube_video_id, video_title,
        channel_name, thumbnail_url, duration_seconds
      ) values (
        ${session.id}, ${session.userId}, ${analysis.normalizedUrl}, ${analysis.videoId}, ${analysis.title},
        ${analysis.channelName}, ${analysis.thumbnailUrl}, ${analysis.durationSeconds}
      ) returning id
    `;
    return NextResponse.json({ ...analysis, analysisId: rows[0].id });
  } catch (error) { return apiError(error); }
}
