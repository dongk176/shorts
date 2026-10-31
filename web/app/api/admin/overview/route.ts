import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { ensureReadDbReady } from "@/lib/db";
import { apiError } from "@/lib/http";
import { loadAdminSubscriptionBilling } from "@/lib/admin-subscription-billing";
import { loadAdminOverview } from "@/lib/admin-overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await ensureReadDbReady();
    await requireAdminUser();
    const overview = new URL(request.url).searchParams.get("view") === "subscription-billing"
      ? await loadAdminSubscriptionBilling() : await loadAdminOverview();
    return NextResponse.json(overview, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const response = apiError(error, "운영 현황을 불러오지 못했습니다.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
