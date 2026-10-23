import { NextResponse } from "next/server";
import { cancellationRequestSchema } from "@/lib/subscription-cancellation";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { setTossSubscriptionCancellation } from "@/lib/toss-billing-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = cancellationRequestSchema;

export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const input = schema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const result = await setTossSubscriptionCancellation({
      userId: session.userId,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
      feedback: input.cancelAtPeriodEnd ? input.feedback : undefined,
    });
    return NextResponse.json({
      ...result,
      accessUntil: result.accessUntil.toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, "구독 해지 설정을 변경하지 못했습니다.");
  }
}
