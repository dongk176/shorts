import { NextResponse } from "next/server";
import { recentUpdateDates } from "@/lib/recent-updates";

export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json({ publishedAt: await recentUpdateDates() }, {
    headers: { "Cache-Control": "no-store" },
  });
}
