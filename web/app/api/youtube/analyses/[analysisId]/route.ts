import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/http";
import { requireMvpSession } from "@/lib/session";
import { getYoutubeAnalysis } from "@/lib/youtube-analysis";

const analysisIdSchema = z.string().uuid();

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ analysisId: string }> }) {
  try {
    const { analysisId } = await context.params;
    const session = await requireMvpSession();
    return NextResponse.json(await getYoutubeAnalysis(session, analysisIdSchema.parse(analysisId)));
  } catch (error) {
    return apiError(error);
  }
}
