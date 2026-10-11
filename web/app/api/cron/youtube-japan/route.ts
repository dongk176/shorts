import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { collectJapanVideos, japanCollectionSlot } from "@/lib/youtube-japan-collector";
export const dynamic = "force-dynamic";
export const maxDuration = 240;
export async function GET(request: Request) {
  const actual = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET || ""}`);
  if (!process.env.CRON_SECRET || actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return NextResponse.json({ detail: "인증되지 않은 수집 요청입니다." }, { status: 401 });
  const scheduledAt = japanCollectionSlot();
  // An authenticated recovery may collect only the latest elapsed slot. The
  // collector still enforces its Pacific-day batch and atomic quota guards.
  const catchUp = new URL(request.url).searchParams.get("catchUp") === "1";
  if (!catchUp && Date.now() - scheduledAt.getTime() > 10 * 60_000)
    return NextResponse.json({ skipped: true, reason: "outside_slot" });
  try {
    const result = await collectJapanVideos({ scheduledAt });
    if ("reason" in result && result.reason === "japan_quota_unverified") {
      console.error("youtube_japan_quota_unverified");
      return NextResponse.json(result, { status: 503 });
    }
    return NextResponse.json(result, { status: ("failed" in result && result.failed) || ("timedOut" in result && result.timedOut) ? 503 : 200 });
  } catch {
    return NextResponse.json({ detail: "일본 수집을 완료하지 못했습니다. 이전 목록은 유지됩니다." }, { status: 503 });
  }
}
