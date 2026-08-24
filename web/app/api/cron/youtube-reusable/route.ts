import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { YoutubeFreeApiError } from "@/lib/youtube-free";
import {
  collectReusablePopularSearchVideos,
  PopularSearchCollectionInProgressError,
} from "@/lib/youtube-popular-search";

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
    return NextResponse.json({ detail: "인증되지 않은 재사용 영상 수집 요청입니다." }, { status: 401 });
  }
  try {
    const result = await collectReusablePopularSearchVideos();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof PopularSearchCollectionInProgressError) {
      return NextResponse.json({ detail: error.message }, { status: 409 });
    }
    const detail = error instanceof YoutubeFreeApiError
      ? error.message
      : "재사용 영상 수집 중 내부 오류가 발생했습니다.";
    console.error("Reusable video collection failed", {
      type: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ detail }, { status: 503 });
  }
}
