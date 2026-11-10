import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { loadAdminBillingOrders } from "@/lib/admin-billing-orders";
import { ensureReadDbReady } from "@/lib/db";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  cursor: z.string().max(2048).optional(),
  status: z.enum([
    "all",
    "pending",
    "processing",
    "succeeded",
    "failed",
    "unknown",
    "manual_review",
    "canceled",
    "expired",
  ]).default("all"),
  provider: z.enum(["all", "nicepay", "thepayone", "toss", "paddle", "paypal"]).default("all"),
  month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/).optional(),
  day: z.string().date().optional(),
  currency: z.enum(["KRW", "USD", "JPY"]).optional(),
  settledOnly: z.enum(["true", "false"]).optional(),
  q: z.string().trim().max(100).default(""),
}).refine(value => !value.day || Boolean(value.month && value.day.startsWith(`${value.month}-`)), "날짜와 조회 월이 일치해야 합니다.");

export async function GET(request: Request) {
  try {
    await ensureReadDbReady();
    await requireAdminUser();
    const url = new URL(request.url);
    const query = querySchema.parse({
      offset: url.searchParams.get("offset") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      provider: url.searchParams.get("provider") ?? undefined,
      month: url.searchParams.get("month") ?? undefined,
      day: url.searchParams.get("day") ?? undefined,
      currency: url.searchParams.get("currency") ?? undefined,
      settledOnly: url.searchParams.get("settledOnly") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    });
    const page = await loadAdminBillingOrders({
      filters: {
        status: query.status,
        provider: query.provider,
        query: query.q,
        month: query.month,
        day: query.day,
        currency: query.currency,
        settledOnly: query.settledOnly === "true",
      },
      cursor: query.cursor,
      offset: query.offset,
    });

    return NextResponse.json(page, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const response = apiError(error, "결제 주문을 더 불러오지 못했습니다.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
