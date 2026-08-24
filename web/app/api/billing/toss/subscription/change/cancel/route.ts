import { NextResponse } from "next/server";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { cancelScheduledTossSubscriptionChange } from "@/lib/toss-billing-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const body = await request.json();
    if (Object.keys(body as Record<string, unknown>).length > 0) {
      throw new SyntaxError("빈 요청만 허용됩니다.");
    }
    const session = await requireAuthenticatedMvpSession();
    const result = await cancelScheduledTossSubscriptionChange({ userId: session.userId });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, "변경 예약을 취소하지 못했습니다.");
  }
}
