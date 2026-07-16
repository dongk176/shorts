import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { createYoutubeAnalysis } from "@/lib/youtube-analysis";
import { analyzeYoutubeUrl } from "@/lib/youtube";

const schema = z.object({ youtubeUrl: z.string().min(1).max(2048) });

export async function POST(request: Request) {
  try {
    const session = await requireAuthenticatedMvpSession();
    const body = schema.parse(await request.json());
    const analysis = await analyzeYoutubeUrl(body.youtubeUrl);
    return NextResponse.json(await createYoutubeAnalysis(session, analysis));
  } catch (error) { return apiError(error); }
}
