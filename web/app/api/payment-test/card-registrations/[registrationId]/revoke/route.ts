import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  createPaymentTrackId,
  decryptCardToken,
  PaymentConfigurationError,
  revokeThePayOneCard,
  ThePayOneError,
} from "@/lib/thepayone";
import {
  assertLocalPaymentMutation,
  assertPaymentTester,
  PaymentTestAccessError,
} from "@/lib/payment-test";
import { requireMvpSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoredRegistration = {
  id: string;
  billingKeyCiphertext: string;
  billingKeyIv: string;
  billingKeyTag: string;
};

function json(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

function paymentError(error: unknown) {
  if (error instanceof PaymentTestAccessError) return json({ detail: error.message }, { status: error.status });
  if (error instanceof PaymentConfigurationError) return json({ detail: error.message }, { status: 503 });
  if (error instanceof ThePayOneError) {
    return json({
      detail: error.outcomeUnknown
        ? "카드 등록 폐기 결과를 확정하지 못했습니다. 더페이원 관리자에서 상태를 확인해 주세요."
        : error.diagnostic ? `${error.message} · 상세: ${error.diagnostic}` : error.message,
      resultCode: error.resultCode,
    }, { status: 502 });
  }
  if (error instanceof z.ZodError) return json({ detail: "카드 등록 ID가 올바르지 않습니다." }, { status: 400 });
  return json({ detail: "더페이원 카드 등록 폐기를 처리하지 못했습니다." }, { status: 500 });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ registrationId: string }> },
) {
  let registrationId: string | null = null;
  let userId: string | null = null;
  try {
    assertLocalPaymentMutation(request);
    const tester = assertPaymentTester(await requireMvpSession());
    userId = tester.userId;
    registrationId = z.string().uuid().parse((await context.params).registrationId);
    const db = getDb();
    const rows = await db`
      update shorts_mvp.payment_method_registrations
      set status='revoking'
      where id=${registrationId} and user_id=${userId} and status in ('active','revoke_failed')
      returning id,billing_key_ciphertext,billing_key_iv,billing_key_tag
    ` as unknown as StoredRegistration[];
    const stored = rows[0];
    if (!stored?.billingKeyCiphertext || !stored.billingKeyIv || !stored.billingKeyTag) {
      throw new PaymentTestAccessError("폐기할 활성 카드 등록을 찾을 수 없습니다.", 404);
    }
    const cardId = decryptCardToken({
      ciphertext: stored.billingKeyCiphertext,
      iv: stored.billingKeyIv,
      tag: stored.billingKeyTag,
    }, registrationId);
    const orderId = createPaymentTrackId("AUDT");
    try {
      const result = await revokeThePayOneCard(cardId, orderId);
      await db.begin(async (tx) => {
        await tx`
          update shorts_mvp.payment_method_registrations
          set status='revoked',revocation_order_id=${orderId},
            revocation_transaction_id=${result.providerTransactionId},revocation_result_code=${result.resultCode},
            revoked_at=now(),billing_key_ciphertext=null,billing_key_iv=null,
            billing_key_tag=null,billing_key_hash=null
          where id=${registrationId} and user_id=${userId} and status='revoking'
        `;
        await tx`
          update shorts_mvp.payment_test_recurring_runs
          set status='stopped',stopped_at=now(),next_charge_at=null,
            payer_name=null,payer_email=null,payer_tel=null
          where registration_id=${registrationId} and user_id=${userId} and status='running'
        `;
      });
      return json({ registration: { id: registrationId, status: "revoked" } });
    } catch (error) {
      await db`
        update shorts_mvp.payment_method_registrations
        set status='revoke_failed',revocation_order_id=${orderId},
          revocation_result_code=${error instanceof ThePayOneError ? error.resultCode : "LOCAL_ERROR"}
        where id=${registrationId} and user_id=${userId} and status='revoking'
      `;
      throw error;
    }
  } catch (error) {
    if (registrationId && userId && !(error instanceof ThePayOneError)) {
      try {
        await getDb()`
          update shorts_mvp.payment_method_registrations set status='revoke_failed'
          where id=${registrationId} and user_id=${userId} and status='revoking'
        `;
      } catch {
        // Keep the original sanitized error.
      }
    }
    return paymentError(error);
  }
}
