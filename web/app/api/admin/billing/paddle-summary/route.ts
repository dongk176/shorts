import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { ensureReadDbReady } from "@/lib/db";
import { loadAdminPaddleSales } from "@/lib/admin-paddle";
import { apiError } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await ensureReadDbReady();
    await requireAdminUser();
    return NextResponse.json({ totals: await loadAdminPaddleSales() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "Paddle 매출을 불러오지 못했습니다.");
  }
}
