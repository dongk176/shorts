import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { loadAdminTrend } from "@/lib/admin-overview";
import { ADMIN_TREND_PERIODS } from "@/lib/admin-trends";
import { ensureReadDbReady } from "@/lib/db";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  metric: z.enum(["sales", "members"]),
  period: z.enum(ADMIN_TREND_PERIODS),
});

export async function GET(request: Request) {
  try {
    await ensureReadDbReady();
    await requireAdminUser();
    const params = new URL(request.url).searchParams;
    const { metric, period } = querySchema.parse({
      metric: params.get("metric"), period: params.get("period"),
    });
    return NextResponse.json(await loadAdminTrend(metric, period), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const response = apiError(error, "그래프를 불러오지 못했습니다.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
