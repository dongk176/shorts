import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { accountConfig, accountServices } from "./runtime";

export async function maintenancePost(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    accountConfig(); // Keep the same local-only and DB guards as publishing.
    const secret = process.env.YOUTUBE_ACCOUNTS_MAINTENANCE_SECRET || "";
    const incoming = request.headers.get("authorization") || "";
    const expected = `Bearer ${secret}`;
    if (secret.length < 32 || Buffer.byteLength(incoming) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(incoming), Buffer.from(expected))) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    return NextResponse.json(await accountServices().retention.run(), { headers });
  } catch {
    return NextResponse.json({ error: "Maintenance unavailable" }, { status: 503, headers });
  }
}
