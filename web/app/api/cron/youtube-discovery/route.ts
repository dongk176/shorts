import { cleanupImportedSnapshots } from "@/lib/youtube-catalog-backfill";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  discoveryEnabled,
  expandedDiscoveryEnabled,
} from "@/lib/youtube-quota";
import {
  collectDiscoveryLane,
  refreshCatalogBatch,
} from "@/lib/youtube-discovery-collector";
import { purgeExpiredCatalog } from "@/lib/youtube-catalog";
import { discoverySlot } from "@/lib/youtube-discovery-time";
import { refreshProjectMetadata } from "@/lib/youtube-project-retention";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  const actual = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET || ""}`);
  if (
    !process.env.CRON_SECRET ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    return NextResponse.json(
      { detail: "인증되지 않은 수집 요청입니다." },
      { status: 401 },
    );
  if (!discoveryEnabled())
    return NextResponse.json({ skipped: true, reason: "disabled" });
  const lane = new URL(request.url).searchParams.get("lane");
  if (
    lane !== "trending" &&
    lane !== "views" &&
    lane !== "reusable" &&
    lane !== "free" &&
    lane !== "refresh"
  )
    return NextResponse.json(
      { detail: "지원하지 않는 수집 종류입니다." },
      { status: 400 },
    );
  try {
    if (lane === "refresh") {
      // Authenticated, bounded rollout refresh uses deployed credentials. The
      // scheduled URL never defers expiry; no operator receives API secrets.
      if (new URL(request.url).searchParams.get("maintenance") === "projects") {
        const result = await refreshProjectMetadata({ deferExpiry: true });
        return NextResponse.json(result, { status: result.failed ? 503 : 200 });
      }
      const projects = await refreshProjectMetadata();
      const result = await refreshCatalogBatch();
      await purgeExpiredCatalog();
      await cleanupImportedSnapshots();
      return NextResponse.json({ ...result, projects }, {
        status: projects.failed || ("failed" in result && result.failed) ? 503 : 200,
      });
    }
    if (!(await expandedDiscoveryEnabled()))
      return NextResponse.json({
        skipped: true,
        reason: "quota_or_backfill_unverified",
      });
    const scheduledAt = discoverySlot(lane);
    if (Date.now() - scheduledAt.getTime() > 10 * 60_000)
      return NextResponse.json({ skipped: true, reason: "outside_slot" });
    const result = await collectDiscoveryLane(lane, { scheduledAt });
    return NextResponse.json(result, {
      status: "failed" in result && result.failed ? 503 : 200,
    });
  } catch (error) {
    console.error("youtube_discovery_failed", {
      lane,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { detail: "수집을 완료하지 못했습니다. 이전 목록은 유지됩니다." },
      { status: 503 },
    );
  }
}
