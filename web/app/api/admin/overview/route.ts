import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { ensureReadDbReady } from "@/lib/db";
import { apiError } from "@/lib/http";
import { loadAdminOverview } from "@/lib/admin-overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureReadDbReady();
    await requireAdminUser();
    const overview = await loadAdminOverview();
    return NextResponse.json(overview, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const response = apiError(error, "운영 현황을 불러오지 못했습니다.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
