import { NextResponse } from "next/server";
import { z } from "zod";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { reconcileTossInitialCheckout } from "@/lib/toss-checkout";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ requestId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const input = schema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const result = await reconcileTossInitialCheckout({
      userId: session.userId,
      requestId: input.requestId,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, "결제 상태를 확인하지 못했습니다.");
  }
}
