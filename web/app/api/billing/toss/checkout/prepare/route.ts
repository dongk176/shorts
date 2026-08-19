import { NextResponse } from "next/server";
import { z } from "zod";
import { assertBillingMutationRequest, billingRequestOrigin } from "@/lib/billing-request";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { prepareTossCheckout } from "@/lib/toss-checkout";
import { isTossPlanCode, type TossPlanCode } from "@/lib/toss-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  targetPlanCode: z.string().refine(isTossPlanCode),
}).strict();

export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const input = schema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const prepared = await prepareTossCheckout({
      userId: session.userId,
      targetPlanCode: input.targetPlanCode as TossPlanCode,
    });
    const origin = billingRequestOrigin(request);
    const successUrl = new URL("/billing/toss/success", origin);
    successUrl.searchParams.set("requestId", prepared.requestId);
    const failUrl = new URL("/billing/toss/fail", origin);
    failUrl.searchParams.set("requestId", prepared.requestId);
    return NextResponse.json({
      ...prepared,
      successUrl: successUrl.toString(),
      failUrl: failUrl.toString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, "결제 준비를 완료하지 못했습니다.");
  }
}
