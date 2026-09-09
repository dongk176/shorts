import { NextResponse } from "next/server";
import { catalogReadsEnabled } from "@/lib/youtube-quota";
import { getTrendingCalendar } from "@/lib/youtube-catalog";
import { validKstDate } from "@/lib/youtube-discovery-time";
import { getBillingSummary } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import {
  assertPopularFilterAccess,
  hasDirectPopularFilterAccess,
  managedPopularFilterOverride,
} from "@/lib/popular-entitlements";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") || "";
  if (!/^\d{4}-\d{2}$/.test(month) || !validKstDate(`${month}-01`))
    return NextResponse.json(
      { detail: "올바른 월을 선택해 주세요." },
      { status: 400 },
    );
  try {
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const [billing, direct, managed] = await Promise.all([
      getBillingSummary(db, session.userId),
      hasDirectPopularFilterAccess(db, session.userId),
      managedPopularFilterOverride(db, session.userId),
    ]);
    assertPopularFilterAccess(billing, direct, managed);
    if (!catalogReadsEnabled())
      return NextResponse.json(
        { detail: "날짜별 수집 기록을 준비 중입니다." },
        { status: 503 },
      );
    return NextResponse.json(await getTrendingCalendar(month, db), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
