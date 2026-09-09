import { discoveryEnabled, expandedDiscoveryEnabled } from "@/lib/youtube-quota";
import { collectDiscoveryLane } from "@/lib/youtube-discovery-collector";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { collectFreeVideos } from "@/lib/youtube-free";
import { collectPopularVideos } from "@/lib/youtube-popular";
import {
  collectPopularSearchVideos,
  POPULAR_SEARCH_PAGE_LIMIT,
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

type CollectionStep = "trending" | "popularSearch" | "free";

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ detail: "인증되지 않은 일일 영상 수집 요청입니다." }, { status: 401 });
  }

  if (discoveryEnabled()) {
    if (await expandedDiscoveryEnabled()) return NextResponse.json({ skipped: true, reason: "expanded_schedule" });
    const scheduledAt = new Date(); scheduledAt.setUTCHours(8, 0, 0, 0);
    if (scheduledAt.getTime() > Date.now()) scheduledAt.setUTCDate(scheduledAt.getUTCDate() - 1);
    const results = [];
    const deadline = Date.now() + 240_000;
    for (const lane of ["trending", "views", "reusable", "free"] as const) {
      try { results.push(await collectDiscoveryLane(lane, { scheduledAt, legacy: true, maxDurationMs: Math.max(0, Math.min(60_000, deadline - Date.now())) })); }
      catch { results.push({ lane, failed: true }); }
    }
    return NextResponse.json({ results }, { status: results.some(result => "failed" in result && result.failed) ? 503 : 200 });
  }

  const results: Partial<Record<CollectionStep, unknown>> = {};
  const failed: CollectionStep[] = [];
  const run = async (step: CollectionStep, collector: () => Promise<unknown>) => {
    try {
      results[step] = await collector();
    } catch (error) {
      failed.push(step);
      console.error("Daily YouTube collection step failed", {
        step,
        type: error instanceof Error ? error.name : "UnknownError",
      });
    }
  };

  await run("trending", () => collectPopularVideos());
  await run("popularSearch", () => collectPopularSearchVideos({
    maxPages: POPULAR_SEARCH_PAGE_LIMIT,
  }));
  await run("free", () => collectFreeVideos({ maxPages: 30 }));

  return NextResponse.json(
    { ok: failed.length === 0, failed, results },
    { status: failed.length === 0 ? 200 : 503 },
  );
}
