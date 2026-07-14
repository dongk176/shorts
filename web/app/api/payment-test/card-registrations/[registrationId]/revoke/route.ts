import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  assertLocalPaymentMutation,
  assertPaymentTester,
  PaymentTestAccessError,
} from "@/lib/payment-test";
import { requireMvpSession } from "@/lib/session";
import {
  createPaymentTrackId,
  decryptCardToken,
  PaymentConfigurationError,
  revokeThePayOneCard,
  ThePayOneError,
} from "@/lib/thepayone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoredRegistration = {
  id: string;
  cardTokenCiphertext: string;
  cardTokenIv: string;
  cardTokenTag: string;
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
    const detail = error.diagnostic ? `${error.message} · 상세: ${error.diagnostic}` : error.message;
    return json({ detail, resultCode: error.resultCode }, { status: 502 });
  }
  if (error instanceof z.ZodError) return json({ detail: "카드 등록 ID가 올바르지 않습니다." }, { status: 400 });
  return json({ detail: "카드 등록 폐기를 처리하지 못했습니다." }, { status: 500 });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ registrationId: string }> },
) {
  let registrationId: string | null = null;
  let userId: string | null = null;
  try {
    assertLocalPaymentMutation(request);
    const session = await requireMvpSession();
    const tester = assertPaymentTester(session);
    userId = tester.userId;
    registrationId = z.string().uuid().parse((await context.params).registrationId);
    const db = getDb();
    const rows = await db`
      update shorts_mvp.payment_method_registrations
      set status='revoking'
      where id=${registrationId}
        and user_id=${userId}
        and status in ('active', 'revoke_failed')
      returning id, card_token_ciphertext, card_token_iv, card_token_tag
    ` as unknown as StoredRegistration[];
    const stored = rows[0];
    if (!stored?.cardTokenCiphertext || !stored.cardTokenIv || !stored.cardTokenTag) {
      throw new PaymentTestAccessError("폐기할 활성 카드 등록을 찾을 수 없습니다.", 404);
    }
    const cardId = decryptCardToken({
      ciphertext: stored.cardTokenCiphertext,
      iv: stored.cardTokenIv,
      tag: stored.cardTokenTag,
    }, registrationId);
    const trackId = createPaymentTrackId("AUDT");
    try {
      const result = await revokeThePayOneCard(cardId, trackId);
      await db`
        update shorts_mvp.payment_method_registrations
        set
          status='revoked',
          revocation_track_id=${trackId},
          revocation_trx_id=${result.providerTransactionId},
          revocation_result_code=${result.resultCode},
          revoked_at=now(),
          card_token_ciphertext=null,
          card_token_iv=null,
          card_token_tag=null
        where id=${registrationId} and user_id=${userId} and status='revoking'
      `;
      return json({ registration: { id: registrationId, status: "revoked" } });
    } catch (error) {
      const resultCode = error instanceof ThePayOneError ? error.resultCode : "LOCAL_ERROR";
      await db`
        update shorts_mvp.payment_method_registrations
        set status='revoke_failed', revocation_track_id=${trackId}, revocation_result_code=${resultCode}
        where id=${registrationId} and user_id=${userId} and status='revoking'
      `;
      throw error;
    }
  } catch (error) {
    if (registrationId && userId && !(error instanceof ThePayOneError)) {
      try {
        const db = getDb();
        await db`
          update shorts_mvp.payment_method_registrations
          set status='revoke_failed'
          where id=${registrationId} and user_id=${userId} and status='revoking'
        `;
      } catch {
        // Keep the original sanitized error response; never include token or SQL details.
      }
    }
    return paymentError(error);
  }
}
