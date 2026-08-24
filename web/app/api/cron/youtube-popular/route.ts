import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  collectPopularVideos,
  PopularCollectionInProgressError,
  YoutubePopularApiError,
} from "@/lib/youtube-popular";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const provided = authorization.slice("Bearer ".length);
  const expectedBuffer = Buffer.from(secret);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length
    && timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ detail: "인증되지 않은 수집 요청입니다." }, { status: 401 });
  }
  try {
    const result = await collectPopularVideos();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof PopularCollectionInProgressError) {
      return NextResponse.json({ detail: error.message }, { status: 409 });
    }
    const detail = error instanceof YoutubePopularApiError
      ? error.message
      : "인기 영상 수집 중 내부 오류가 발생했습니다.";
    console.error("Popular video collection failed", {
      type: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ detail }, { status: 503 });
  }
}
