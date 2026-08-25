import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOriginJsonRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { requireEnterprisePaymentOwner } from "@/lib/enterprise-payment-auth";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ token: string }> };
const schema = z.object({
  intentId: z.string().uuid(),
  code: z.string().trim().min(1).max(100).optional(),
  message: z.string().trim().min(1).max(300).optional(),
}).strict();

export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOriginJsonRequest(request, "기업 카드등록 실패 기록");
    const [{ token }, input] = await Promise.all([
      params.then((value) => z.object({ token: z.string().uuid() }).parse(value)),
      request.json().then((value) => schema.parse(value)),
    ]);
    const { session, paymentRequest } = await requireEnterprisePaymentOwner(token);
    const db = getDb();
    await db.begin(async (tx) => {
      await tx`
        update shorts_mvp.enterprise_billing_registration_intents
        set status='failed',failure_code=${input.code || "AUTH_FAILED"},
          failure_message=${input.message || "카드등록이 완료되지 않았습니다."}
        where id=${input.intentId}
          and payment_request_id=${paymentRequest.requestId}
          and app_user_id=${session.userId} and status='prepared'
      `;
      await tx`
        update shorts_mvp.enterprise_billing_profiles profile
        set status='unregistered'
        where profile.managed_account_id=${paymentRequest.managedAccountId}
          and profile.payment_method_id is null
          and not exists (
            select 1 from shorts_mvp.enterprise_billing_registration_intents intent
            where intent.managed_account_id=profile.managed_account_id
              and intent.status in ('prepared','manual_review')
          )
      `;
    });
    return NextResponse.json({ ok: true }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error, "카드등록 실패 상태를 기록하지 못했습니다.");
  }
}
