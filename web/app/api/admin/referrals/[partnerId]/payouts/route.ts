import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
import { resolveSettlementMonth } from "@/lib/referral-settlement";
import { prepareReferralPayout } from "@/lib/referral-payout-service";

const schema = z.object({
  requestId: z.string().uuid(), settlementMonth: z.string().optional(),
  periodStart: z.string().optional(), periodEnd: z.string().optional(),
  note: z.string().trim().max(500).optional(),
});
export async function POST(request: NextRequest, context: { params: Promise<{ partnerId: string }> }) {
  try {
    assertSameOriginJsonRequest(request);
    const [admin, { partnerId }, body] = await Promise.all([
      requireAdminUser(), context.params, request.json().then((value) => schema.parse(value)),
    ]);
    let month: string;
    try { month = resolveSettlementMonth(body); }
    catch { throw new HttpError(400, "실적 월 또는 월초~월말 정산 기간을 입력해 주세요.", "INVALID_PAYOUT_PERIOD"); }
    const result = await getDb().begin((tx) => prepareReferralPayout(tx, {
      partnerId, actorId: admin.id, requestId: body.requestId, month, note: body.note,
    }));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") {
      return apiError(new HttpError(409, "이미 생성된 실적 월 정산입니다.", "PAYOUT_PERIOD_DUPLICATE"));
    }
    return apiError(error, "정산을 준비하지 못했습니다.");
  }
}
