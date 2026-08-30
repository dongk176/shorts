import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { createYoutubeAnalysis } from "@/lib/youtube-analysis";
import { assertYoutubeAnalysisRequestAllowed } from "@/lib/youtube-analysis-rate-limit";
import { analyzeYoutubeUrl } from "@/lib/youtube";

const schema = z.object({ youtubeUrl: z.string().trim().min(1).max(2048) });

export async function POST(request: Request) {
  try {
    const session = await requireAuthenticatedMvpSession();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      throw new HttpError(
        400,
        "YouTube 영상 주소를 입력해 주세요.",
        "INVALID_YOUTUBE_URL",
      );
    }
    const body = parsed.data;
    await assertYoutubeAnalysisRequestAllowed(session.userId);
    const analysis = await analyzeYoutubeUrl(body.youtubeUrl, {
      allowCompletedLiveReplay: true,
    });
    return NextResponse.json(await createYoutubeAnalysis(session, analysis));
  } catch (error) { return apiError(error); }
}
