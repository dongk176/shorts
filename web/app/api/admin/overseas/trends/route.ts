import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOverseasAdminUser } from "@/lib/admin-overseas-auth";
import { loadAdminOverseasTrend } from "@/lib/admin-overseas";
import { ADMIN_TREND_PERIODS } from "@/lib/admin-trends";
import { ensureReadDbReady } from "@/lib/db";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({metric:z.enum(["sales","members"]),period:z.enum(ADMIN_TREND_PERIODS),currency:z.enum(["USD","JPY"])});
export async function GET(request: Request) {
  try {
    await ensureReadDbReady();
    await requireOverseasAdminUser();
    const params=new URL(request.url).searchParams;
    const {metric,period,currency}=schema.parse({metric:params.get("metric"),period:params.get("period"),currency:params.get("currency")||"USD"});
    return NextResponse.json(await loadAdminOverseasTrend(metric,period,currency),{headers:{"Cache-Control":"private, no-store"}});
  } catch(error) {
    const response=apiError(error,"해외 그래프를 불러오지 못했습니다.");
    response.headers.set("Cache-Control","private, no-store");
    return response;
  }
}
