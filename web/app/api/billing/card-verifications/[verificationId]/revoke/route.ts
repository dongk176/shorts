import { NextResponse } from "next/server";
import { z } from "zod";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { revokeOwnedBillingCardVerification } from "@/lib/billing-card-verifications";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { ThePayOneError } from "@/lib/thepayone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ verificationId: string }> },
) {
  try {
    assertBillingMutationRequest(request);
    const session = await requireAuthenticatedMvpSession();
    const verificationId = z.string().uuid().parse((await context.params).verificationId);
    const status = await revokeOwnedBillingCardVerification(
      getDb(),
      verificationId,
      session.userId,
    );
    return NextResponse.json(
      { verification: { id: verificationId, status } },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    if (error instanceof ThePayOneError) {
      console.error("thepayone_card_verification_revoke_failed", {
        resultCode: error.resultCode,
        outcomeUnknown: error.outcomeUnknown,
      });
    }
    return apiError(error, "임시 카드 인증을 폐기하지 못했습니다.");
  }
}
