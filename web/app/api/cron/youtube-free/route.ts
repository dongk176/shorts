import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  collectFreeVideos,
  FreeCollectionInProgressError,
  YoutubeFreeApiError,
} from "@/lib/youtube-free";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_COLLECTION_PAGE_LIMIT = 30;
const MAX_COLLECTION_PAGE_LIMIT = 30;

function collectionPageLimit() {
  const configured = Number.parseInt(
    process.env.FREE_SEARCH_MAX_PAGES || String(DEFAULT_COLLECTION_PAGE_LIMIT),
    10,
  );
  return Number.isFinite(configured)
    ? Math.min(MAX_COLLECTION_PAGE_LIMIT, Math.max(1, configured))
    : DEFAULT_COLLECTION_PAGE_LIMIT;
}

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
    return NextResponse.json({ detail: "인증되지 않은 무료 소재 수집 요청입니다." }, { status: 401 });
  }
  try {
    const result = await collectFreeVideos({ maxPages: collectionPageLimit() });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof FreeCollectionInProgressError) {
      return NextResponse.json({ detail: error.message }, { status: 409 });
    }
    const detail = error instanceof YoutubeFreeApiError
      ? error.message
      : "무료 소재 수집 중 내부 오류가 발생했습니다.";
    console.error("Free video collection failed", {
      type: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ detail }, { status: 503 });
  }
}
