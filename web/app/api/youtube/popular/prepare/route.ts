import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/http";
import { requireMvpSession } from "@/lib/session";
import { createYoutubeAnalysis } from "@/lib/youtube-analysis";
import { getStoredFreeVideo } from "@/lib/youtube-free";
import { getStoredPopularVideo } from "@/lib/youtube-popular";
import { getStoredPopularSearchVideo } from "@/lib/youtube-popular-search";
import { analyzeYoutubeUrl } from "@/lib/youtube";

const schema = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  source: z.enum(["free", "popular"]).default("free"),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const session = await requireMvpSession(undefined, {
      enforcePaymentMethodRemediation: true,
    });
    const video = input.source === "popular"
      ? await getStoredPopularVideo(input.videoId) || await getStoredPopularSearchVideo(input.videoId)
      : await getStoredFreeVideo(input.videoId);
    if (!video) throw new Error("인기 영상 목록에서 해당 영상을 찾을 수 없습니다. 목록을 새로고침해 주세요.");
    const metadata = await analyzeYoutubeUrl(`https://www.youtube.com/watch?v=${video.videoId}`);
    const analysis = await createYoutubeAnalysis(session, metadata);
    return NextResponse.json(analysis, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
