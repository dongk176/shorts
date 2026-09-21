import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { accountServices } from "@/lib/youtube-accounts/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  const expected = `Bearer ${process.env.CRON_SECRET || ""}`, incoming = request.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || Buffer.byteLength(expected) !== Buffer.byteLength(incoming) || !timingSafeEqual(Buffer.from(expected), Buffer.from(incoming))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.YOUTUBE_ACCOUNTS_MODE !== "review") return NextResponse.json({ skipped: true });
  try { return NextResponse.json(await accountServices().retention.run(), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "YouTube maintenance failed" }, { status: 503 }); }
}
