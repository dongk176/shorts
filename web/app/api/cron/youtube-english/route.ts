import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { collectEnglishVideos, englishCollectionSlot } from "@/lib/youtube-english-collector";
export const dynamic = "force-dynamic";
export const maxDuration = 240;
export async function GET(request: Request) {
  const actual = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET || ""}`);
  if (!process.env.CRON_SECRET || actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return NextResponse.json({ detail: "인증되지 않은 수집 요청입니다." }, { status: 401 });
  const scheduledAt = englishCollectionSlot();
  // Vercel's authenticated Run action and delayed cron delivery use only the
  // latest elapsed slot. The collector's unique claim and daily quota still apply.
  try {
    const result = await collectEnglishVideos({ scheduledAt });
    return NextResponse.json(result, { status:
      ("reason" in result && result.reason === "english_quota_unverified")
      || ("failed" in result && result.failed) || ("timedOut" in result && result.timedOut) ? 503 : 200 });
  } catch {
    return NextResponse.json({ detail: "영어권 수집을 완료하지 못했습니다. 이전 목록은 유지됩니다." }, { status: 503 });
  }
}
