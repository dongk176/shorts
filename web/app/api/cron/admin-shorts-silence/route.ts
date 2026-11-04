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
  try { return NextResponse.json(await processAdminShortSilence(getDb())); }
  catch (error) { return apiError(error); }
}
