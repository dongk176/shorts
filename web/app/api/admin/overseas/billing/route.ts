import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOverseasAdminUser } from "@/lib/admin-overseas-auth";
import { loadOverseasBilling } from "@/lib/admin-overseas-billing";
import { ensureReadDbReady } from "@/lib/db";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({
  month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
  day: z.string().date().optional(),
  currency: z.enum(["USD", "JPY", "all"]).default("all"),
  provider: z.enum(["all", "paddle", "paypal"]).default("all"),
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).max(10000).default(1),
}).refine(value => !value.day || value.day.startsWith(`${value.month}-`), "날짜와 조회 월이 일치해야 합니다.");
export async function GET(request: Request) {
  try {
    await requireOverseasAdminUser();
    const query = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
    await ensureReadDbReady();
    return NextResponse.json(await loadOverseasBilling({...query,query:query.q}),{headers:{"Cache-Control":"private, no-store"}});
  } catch(error) {
    const response=apiError(error,"해외 결제 내역을 불러오지 못했습니다.");
    response.headers.set("Cache-Control","private, no-store");
    return response;
  }
}
