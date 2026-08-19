import { NextResponse } from "next/server";
import { z } from "zod";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { completeTossCheckout } from "@/lib/toss-checkout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  requestId: z.string().uuid(),
  customerKey: z.string().min(10).max(100),
  authKey: z.string().min(10).max(500),
}).strict();

export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const input = schema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const result = await completeTossCheckout({ userId: session.userId, ...input });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, "결제를 완료하지 못했습니다.");
  }
}
