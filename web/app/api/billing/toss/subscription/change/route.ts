import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { changeTossSubscription } from "@/lib/toss-billing-service";
import { isTossPlanCode, type TossPlanCode } from "@/lib/toss-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  targetPlanCode: z.string().refine(isTossPlanCode),
  requestId: z.string().uuid().optional(),
}).strict();

export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const input = schema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const result = await changeTossSubscription({
      userId: session.userId,
      requestId: input.requestId ?? randomUUID(),
      targetPlanCode: input.targetPlanCode as TossPlanCode,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, "요금제를 변경하지 못했습니다.");
  }
}
