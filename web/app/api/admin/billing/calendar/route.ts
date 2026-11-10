import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { ensureReadDbReady } from "@/lib/db";
import { apiError } from "@/lib/http";
import { loadBillingCalendar } from "@/lib/admin-billing-calendar-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const billingCalendarQuery = z.object({
  month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
  currency: z.enum(["KRW", "USD", "JPY"]).default("KRW"),
  provider: z.enum(["all", "nicepay", "thepayone", "toss", "paddle", "paypal"]).default("all"),
  q: z.string().trim().max(100).default(""),
});

export async function GET(request: Request) {
  try {
    await requireAdminUser();
    const query = billingCalendarQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
    await ensureReadDbReady();
    return NextResponse.json(await loadBillingCalendar({ ...query, query: query.q }), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const response = apiError(error, "월별 매출을 불러오지 못했습니다.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
