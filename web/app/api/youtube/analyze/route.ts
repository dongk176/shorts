import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/http";
import { requireMvpSession } from "@/lib/session";
import { analyzeYoutubeUrl } from "@/lib/youtube";

const schema = z.object({ youtubeUrl: z.string().min(1).max(2048) });

export async function POST(request: Request) {
  try {
    await requireMvpSession();
    const body = schema.parse(await request.json());
    return NextResponse.json(await analyzeYoutubeUrl(body.youtubeUrl));
  } catch (error) { return apiError(error); }
}
