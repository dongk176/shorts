import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  assertLocalPaymentMutation,
  assertPaymentTester,
  isHanaCardIssuerName,
  PaymentTestAccessError,
} from "@/lib/payment-test";
import { requireMvpSession } from "@/lib/session";
import {
  chargeThePayOneRecurringCard,
  createPaymentTrackId,
  decryptCardToken,
  PaymentConfigurationError,
  ThePayOneError,
} from "@/lib/thepayone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Claim = {
  state: "claimed";
  attemptId: string;
  runId: string;
  registrationId: string;
  sequenceNo: number;
  targetChargeCount: number;
  intervalSeconds: number;
  amount: number;
  trackId: string;
  payerName: string;
  payerEmail: string;
  payerTel: string;
  cardTokenCiphertext: string;
  cardTokenIv: string;
  cardTokenTag: string;
};

type ClaimResult = Claim | { state: "idle" | "unknown" };

type RunClaimRow = {
  id: string;
  registrationId: string;
  amount: number;
  targetChargeCount: number;
  intervalSeconds: number;
  succeededChargeCount: number;
  nextChargeAt: Date;
  payerName: string;
  payerEmail: string;
  payerTel: string;
  registrationStatus: string;
  cardIssuer: string | null;
  cardTokenCiphertext: string;
  cardTokenIv: string;
  cardTokenTag: string;
};

type ExistingAttempt = {
  id: string;
  status: string;
  startedAt: Date;
};

function json(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

function paymentError(error: unknown) {
  if (error instanceof PaymentTestAccessError) {
    return json({ detail: error.message, errorCode: error.errorCode }, { status: error.status });
  }
  if (error instanceof PaymentConfigurationError) return json({ detail: error.message }, { status: 503 });
  if (error instanceof ThePayOneError) {
    const detail = error.outcomeUnknown
      ? "결제 응답을 확정하지 못했습니다. 중복결제를 막기 위해 테스트를 중단했습니다. PG 관리자 화면에서 승인 여부를 확인해 주세요."
      : error.diagnostic ? `${error.message} · 상세: ${error.diagnostic}` : error.message;
    return json({
      detail,
      errorCode: error.outcomeUnknown ? "PAYMENT_OUTCOME_UNKNOWN" : "PAYMENT_FAILED",
      resultCode: error.resultCode,
    }, { status: 502 });
  }
  if (error instanceof z.ZodError) return json({ detail: "반복결제 테스트 ID가 올바르지 않습니다." }, { status: 400 });
  return json({ detail: "반복결제 회차를 처리하지 못했습니다." }, { status: 500 });
}

async function claimDueAttempt(runId: string, userId: string): Promise<ClaimResult> {
  const db = getDb();
  return db.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${runId}, 0))`;
    const rows = await tx`
      select
        r.id, r.registration_id, r.amount, r.target_charge_count, r.interval_seconds,
        r.succeeded_charge_count, r.next_charge_at, r.payer_name,
        r.payer_email, r.payer_tel, p.status as registration_status,
        p.card_issuer, p.card_token_ciphertext, p.card_token_iv, p.card_token_tag
      from shorts_mvp.payment_test_recurring_runs r
      join shorts_mvp.payment_method_registrations p on p.id=r.registration_id
      where r.id=${runId} and r.user_id=${userId} and r.status='running'
      for update of r
    ` as unknown as RunClaimRow[];
    const run = rows[0];
    if (!run || run.nextChargeAt.getTime() > Date.now()) return { state: "idle" };
    if (
      run.registrationStatus !== "active"
      || !run.cardTokenCiphertext
      || !run.cardTokenIv
      || !run.cardTokenTag
    ) {
      await tx`
        update shorts_mvp.payment_test_recurring_runs
        set status='failed', next_charge_at=null, payer_name=null, payer_email=null, payer_tel=null
        where id=${runId} and user_id=${userId} and status='running'
      `;
      throw new PaymentTestAccessError("등록 카드가 더 이상 활성 상태가 아니어서 반복결제를 중단했습니다.", 409);
    }
    if (isHanaCardIssuerName(run.cardIssuer)) {
      await tx`
        update shorts_mvp.payment_test_recurring_runs
        set status='failed', next_charge_at=null, payer_name=null, payer_email=null, payer_tel=null
        where id=${runId} and user_id=${userId} and status='running'
      `;
      throw new PaymentTestAccessError(
        "하나카드는 반복결제를 지원하지 않아 테스트를 중단했습니다.",
        422,
        "HANA_CARD_UNSUPPORTED",
      );
    }
    const sequenceNo = run.succeededChargeCount + 1;
    if (sequenceNo > run.targetChargeCount) return { state: "idle" };
    const existingRows = await tx`
      select id, status, started_at
      from shorts_mvp.payment_test_charge_attempts
      where run_id=${runId} and sequence_no=${sequenceNo}
      limit 1
    ` as unknown as ExistingAttempt[];
    const existing = existingRows[0];
    if (existing) {
      if (existing.status === "processing" && existing.startedAt.getTime() < Date.now() - 2 * 60 * 1000) {
        await tx`
          update shorts_mvp.payment_test_charge_attempts
          set status='unknown', provider_result_code='PROCESS_INTERRUPTED', finished_at=now()
          where id=${existing.id} and status='processing'
        `;
        await tx`
          update shorts_mvp.payment_test_recurring_runs
          set status='unknown', next_charge_at=null, payer_name=null, payer_email=null, payer_tel=null
          where id=${runId} and user_id=${userId} and status='running'
        `;
        return { state: "unknown" };
      }
      return { state: "idle" };
    }
    const attemptId = randomUUID();
    const trackId = createPaymentTrackId("PAY");
    await tx`
      insert into shorts_mvp.payment_test_charge_attempts (
        id, run_id, sequence_no, track_id, amount, status, scheduled_for
      ) values (
        ${attemptId}, ${runId}, ${sequenceNo}, ${trackId}, ${run.amount},
        'processing', ${run.nextChargeAt}
      )
    `;
    return {
      state: "claimed",
      attemptId,
      runId,
      registrationId: run.registrationId,
      sequenceNo,
      targetChargeCount: run.targetChargeCount,
      intervalSeconds: run.intervalSeconds,
      amount: run.amount,
      trackId,
      payerName: run.payerName,
      payerEmail: run.payerEmail,
      payerTel: run.payerTel,
      cardTokenCiphertext: run.cardTokenCiphertext,
      cardTokenIv: run.cardTokenIv,
      cardTokenTag: run.cardTokenTag,
    };
  });
}

async function markAttemptFailed(claim: Claim, error: unknown) {
  const unknown = error instanceof ThePayOneError && error.outcomeUnknown;
  const resultCode = error instanceof ThePayOneError ? error.resultCode : "LOCAL_ERROR";
  const status = unknown ? "unknown" : "failed";
  const db = getDb();
  await db.begin(async (tx) => {
    await tx`
      update shorts_mvp.payment_test_charge_attempts
      set status=${status}, provider_result_code=${resultCode}, finished_at=now()
      where id=${claim.attemptId} and status='processing'
    `;
    await tx`
      update shorts_mvp.payment_test_recurring_runs
      set status=${status}, next_charge_at=null, payer_name=null, payer_email=null, payer_tel=null
      where id=${claim.runId} and status='running'
    `;
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    assertLocalPaymentMutation(request);
    const session = await requireMvpSession();
    const tester = assertPaymentTester(session);
    const runId = z.string().uuid().parse((await context.params).runId);
    const claim = await claimDueAttempt(runId, tester.userId);
    if (claim.state !== "claimed") {
      return json({ processed: false, status: claim.state });
    }

    let cardId: string;
    try {
      cardId = decryptCardToken({
        ciphertext: claim.cardTokenCiphertext,
        iv: claim.cardTokenIv,
        tag: claim.cardTokenTag,
      }, claim.registrationId);
    } catch (error) {
      await markAttemptFailed(claim, error);
      throw error;
    }

    let providerResult;
    try {
      providerResult = await chargeThePayOneRecurringCard({
        trackId: claim.trackId,
        cardId,
        amount: claim.amount,
        payerName: claim.payerName,
        payerEmail: claim.payerEmail,
        payerTel: claim.payerTel,
        referenceId: claim.runId,
      });
    } catch (error) {
      await markAttemptFailed(claim, error);
      throw error;
    }

    try {
      const complete = claim.sequenceNo >= claim.targetChargeCount;
      const nextChargeAt = complete ? null : new Date(Date.now() + claim.intervalSeconds * 1000);
      const db = getDb();
      await db.begin(async (tx) => {
        const attempts = await tx`
          update shorts_mvp.payment_test_charge_attempts
          set
            status='succeeded', provider_trx_id=${providerResult.providerTransactionId},
            provider_result_code=${providerResult.resultCode}, finished_at=now()
          where id=${claim.attemptId} and status='processing'
          returning id
        `;
        if (!attempts[0]) throw new Error("결제 시도 상태를 확정하지 못했습니다.");
        await tx`
          update shorts_mvp.payment_test_recurring_runs
          set
            succeeded_charge_count=${claim.sequenceNo},
            status=${complete ? "completed" : "running"},
            next_charge_at=${nextChargeAt},
            completed_at=${complete ? new Date() : null},
            payer_name=${complete ? null : claim.payerName},
            payer_email=${complete ? null : claim.payerEmail},
            payer_tel=${complete ? null : claim.payerTel}
          where id=${claim.runId} and status='running'
        `;
        await tx`
          update shorts_mvp.payment_method_registrations
          set
            card_last4=coalesce(${providerResult.last4}, card_last4),
            card_issuer=coalesce(${providerResult.issuer}, card_issuer),
            card_type=coalesce(${providerResult.cardType}, card_type),
            card_acquirer=coalesce(${providerResult.acquirer}, card_acquirer)
          where id=${claim.registrationId} and user_id=${tester.userId}
        `;
      });
      return json({
        processed: true,
        sequenceNo: claim.sequenceNo,
        status: complete ? "completed" : "running",
        nextChargeAt: nextChargeAt?.toISOString() || null,
      });
    } catch {
      await markAttemptFailed(claim, new ThePayOneError(
        "결제 승인 후 로컬 상태를 확정하지 못했습니다.",
        "LOCAL_COMMIT_UNKNOWN",
        null,
        true,
      )).catch(() => undefined);
      throw new ThePayOneError(
        "결제 승인 후 로컬 상태를 확정하지 못했습니다.",
        "LOCAL_COMMIT_UNKNOWN",
        null,
        true,
      );
    }
  } catch (error) {
    return paymentError(error);
  }
}
