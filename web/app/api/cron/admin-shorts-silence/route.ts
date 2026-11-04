import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { processAdminShortSilence } from "@/lib/shorts-silence-processing";
import { apiError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : "";
  const given = request.headers.get("authorization") || "";
  const expectedBytes = Buffer.from(expected), givenBytes = Buffer.from(given);
  if (!expected || givenBytes.length !== expectedBytes.length || !timingSafeEqual(givenBytes, expectedBytes)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const started = Date.now();
    const results = [];
    // Each analysis has a 120s timeout. Start another only within the first
    // 40s, leaving room inside this route's 180s limit; keep the global lease.
    for (let i = 0; i < 4; i++) {
      if (i > 0 && Date.now() - started >= 40_000) break;
      const result = await processAdminShortSilence(getDb());
      results.push(result);
      if (result.status === "idle" || result.status === "disabled") break;
    }
    return NextResponse.json({ results });
  }
  catch (error) { return apiError(error); }
}
