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
  provider: z.enum(["all", "nicepay", "thepayone", "toss"]).default("all"),
  q: z.string().trim().max(100).default(""),
});

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
      q: url.searchParams.get("q") ?? undefined,
    });
    const page = await loadAdminBillingOrders({
      filters: {
        status: query.status,
        provider: query.provider,
        query: query.q,
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
