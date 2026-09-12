import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getPublicSiteMetrics } from "@/lib/reusable-view-counter-server";

export const dynamic = "force-dynamic";

// These two totals are already public on the home page. Cache only their data,
// not the response clock, so the browser never starts its animation 30s behind.
let cached: { expiresAt: number; value: Awaited<ReturnType<typeof getPublicSiteMetrics>> } | null = null;
let pending: Promise<Awaited<ReturnType<typeof getPublicSiteMetrics>>> | null = null;

export async function GET() {
  try {
    if (!cached || cached.expiresAt <= Date.now()) {
      pending ??= getPublicSiteMetrics(getDb()).then(value => {
        cached = { value, expiresAt: Date.now() + 30_000 };
        return value;
      }).finally(() => { pending = null; });
      await pending;
    }
    const value = cached!.value;
    return NextResponse.json({
      generatedShortCount: value.generatedShortCount,
      reusableViewCounter: value.reusableViewCounter
        ? { ...value.reusableViewCounter, serverNow: new Date().toISOString() }
        : null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ detail: "집계 정보를 잠시 불러올 수 없습니다." }, {
      status: 503, headers: { "Cache-Control": "private, no-store" },
    });
  }
}
