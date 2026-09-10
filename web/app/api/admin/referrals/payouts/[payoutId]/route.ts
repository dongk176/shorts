import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
import { finalizeReferralPayout } from "@/lib/referral-payout-service";

const schema = z.object({
  requestId: z.string().uuid(), action: z.enum(["paid", "canceled"]),
  confirmedAmountKrw: z.number().int().positive().optional(),
  transferReference: z.string().trim().max(200).optional(),
});
export async function PATCH(request: NextRequest, context: { params: Promise<{ payoutId: string }> }) {
  try {
    assertSameOriginJsonRequest(request);
    const [admin, { payoutId }, body] = await Promise.all([
      requireAdminUser(), context.params, request.json().then((value) => schema.parse(value)),
    ]);
    const result = await getDb().begin((tx) => finalizeReferralPayout(tx, {
      ...body, payoutId, actorId: admin.id,
    }));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiError(error, "정산 상태를 변경하지 못했습니다.");
  }
}
