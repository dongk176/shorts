import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { loadAdminBillingSupportingData } from "@/lib/admin-billing-supporting-data";
import { ensureReadDbReady } from "@/lib/db";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureReadDbReady();
    await requireAdminUser();
    const result = await loadAdminBillingSupportingData();
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const response = apiError(error, "결제 보조 정보를 불러오지 못했습니다.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
