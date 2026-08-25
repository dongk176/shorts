import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOriginJsonRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { requireEnterprisePaymentOwner } from "@/lib/enterprise-payment-auth";
import { apiError, HttpError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ token: string }> };

const schema = z.object({
  purchaseTermsAgreed: z.literal(true),
  refundPolicyAgreed: z.literal(true),
  storedCardChargeAgreed: z.literal(true),
}).strict();

export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOriginJsonRequest(request, "기업 결제 약관동의");
    const [{ token }, input] = await Promise.all([
      params.then((value) => z.object({ token: z.string().uuid() }).parse(value)),
      request.json().then((value) => schema.parse(value)),
    ]);
    const { session, paymentRequest } = await requireEnterprisePaymentOwner(token);
    if (paymentRequest.status === "canceled") throw new HttpError(409, "취소된 결제 요청입니다.");
    if (new Date(paymentRequest.expiresAt).getTime() <= Date.now()) {
      throw new HttpError(410, "결제 기한이 만료되었습니다.");
    }
    const db = getDb();
    const consent = await db.begin(async (tx) => {
      const requestRows = await tx`
        select purchase_terms_version,purchase_terms_hash,
          refund_policy_version,refund_policy_hash,consent_copy_version
        from shorts_mvp.enterprise_payment_requests
        where id=${paymentRequest.requestId}
        for update
      `;
      const legal = requestRows[0];
      if (!legal) throw new HttpError(404, "결제 요청을 찾을 수 없습니다.");
      const existing = await tx`
        select id from shorts_mvp.enterprise_payment_consents
        where payment_request_id=${paymentRequest.requestId}
        limit 1
      `;
      if (existing[0]) return existing[0];
      const rows = await tx`
        insert into shorts_mvp.enterprise_payment_consents (
          payment_request_id,managed_account_id,app_user_id,
          purchase_terms_version,purchase_terms_hash,
          refund_policy_version,refund_policy_hash,consent_copy_version,
          purchase_terms_agreed,refund_policy_agreed,stored_card_charge_agreed
        ) values (
          ${paymentRequest.requestId},${paymentRequest.managedAccountId},${session.userId},
          ${legal.purchaseTermsVersion},${legal.purchaseTermsHash},
          ${legal.refundPolicyVersion},${legal.refundPolicyHash},
          ${legal.consentCopyVersion},${input.purchaseTermsAgreed},
          ${input.refundPolicyAgreed},${input.storedCardChargeAgreed}
        ) returning id
      `;
      await tx`
        update shorts_mvp.enterprise_payment_requests
        set consented_at=clock_timestamp()
        where id=${paymentRequest.requestId}
      `;
      return rows[0];
    });
    return NextResponse.json({ ok: true, consentId: consent.id }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error, "약관동의를 저장하지 못했습니다.");
  }
}
