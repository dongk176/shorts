import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { getTossBillingState } from "@/lib/toss-billing-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireAuthenticatedMvpSession();
    const state = await getTossBillingState({ userId: session.userId, session });
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, "구독 정보를 불러오지 못했습니다.");
  }
}
