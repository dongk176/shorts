import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  assertLocalPaymentMutation,
  assertLocalPaymentTestHost,
  assertPaymentTester,
  isHanaCardIssuerName,
  PAYMENT_TEST_CHARGE_AMOUNT,
  PAYMENT_TEST_CHARGE_COUNT,
  PAYMENT_TEST_CONFIRMATION,
  PAYMENT_TEST_INTERVAL_SECONDS,
  PaymentTestAccessError,
} from "@/lib/payment-test";
import { requireMvpSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startSchema = z.object({
  requestId: z.string().uuid(),
  registrationId: z.string().uuid(),
  payerName: z.string().trim().min(1).max(20),
  payerEmail: z.string().trim().email().max(100),
  payerTel: z.string().transform((value) => value.replace(/[^0-9]/g, "")).refine((value) => /^\d{10,11}$/.test(value)),
  confirmation: z.literal(PAYMENT_TEST_CONFIRMATION),
  consent: z.literal(true),
}).strict();

type RunRow = {
  id: string;
  registrationId: string;
  status: "running" | "completed" | "stopped" | "failed" | "unknown";
  amount: number;
  intervalSeconds: number;
  targetChargeCount: number;
  succeededChargeCount: number;
  nextChargeAt: Date | null;
  startedAt: Date;
  completedAt: Date | null;
  stoppedAt: Date | null;
  createdAt: Date;
  cardLast4: string | null;
  cardIssuer: string | null;
};

type AttemptRow = {
  id: string;
  runId: string;
  sequenceNo: number;
  status: "processing" | "succeeded" | "failed" | "unknown";
  amount: number;
  providerTrxId: string | null;
  providerResultCode: string | null;
  scheduledFor: Date;
  startedAt: Date;
  finishedAt: Date | null;
};

type RegistrationRow = {
  id: string;
  cardIssuer: string | null;
};

function json(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

function iso(value: Date | null) {
  return value?.toISOString() || null;
}

function safeRun(row: RunRow, attempts: AttemptRow[] = []) {
  return {
    id: row.id,
    registrationId: row.registrationId,
    status: row.status,
    amount: row.amount,
    intervalSeconds: row.intervalSeconds,
    targetChargeCount: row.targetChargeCount,
    succeededChargeCount: row.succeededChargeCount,
    nextChargeAt: iso(row.nextChargeAt),
    startedAt: row.startedAt.toISOString(),
    completedAt: iso(row.completedAt),
    stoppedAt: iso(row.stoppedAt),
    createdAt: row.createdAt.toISOString(),
    cardLast4: row.cardLast4,
    cardIssuer: row.cardIssuer,
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      sequenceNo: attempt.sequenceNo,
      status: attempt.status,
      amount: attempt.amount,
      providerTransactionId: attempt.providerTrxId,
      resultCode: attempt.providerResultCode,
      scheduledFor: attempt.scheduledFor.toISOString(),
      startedAt: attempt.startedAt.toISOString(),
      finishedAt: iso(attempt.finishedAt),
    })),
  };
}

function paymentError(error: unknown) {
  if (error instanceof PaymentTestAccessError) {
    return json({ detail: error.message, errorCode: error.errorCode }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return json({ detail: "반복결제 테스트 입력값과 확인 문구를 확인해 주세요." }, { status: 400 });
  }
  return json({ detail: "반복결제 테스트를 처리하지 못했습니다." }, { status: 500 });
}

async function listRuns(userId: string) {
  const db = getDb();
  const runs = await db`
    select
      r.id, r.registration_id, r.status, r.amount, r.interval_seconds,
      r.target_charge_count, r.succeeded_charge_count, r.next_charge_at,
      r.started_at, r.completed_at, r.stopped_at, r.created_at,
      p.card_last4, p.card_issuer
    from shorts_mvp.payment_test_recurring_runs r
    join shorts_mvp.payment_method_registrations p on p.id=r.registration_id
    where r.user_id=${userId}
    order by r.created_at desc
    limit 10
  ` as unknown as RunRow[];
  const attempts = await db`
    select
      a.id, a.run_id, a.sequence_no, a.status, a.amount,
      a.provider_trx_id, a.provider_result_code, a.scheduled_for,
      a.started_at, a.finished_at
    from shorts_mvp.payment_test_charge_attempts a
    join shorts_mvp.payment_test_recurring_runs r on r.id=a.run_id
    where r.user_id=${userId}
    order by a.created_at
  ` as unknown as AttemptRow[];
  return runs.map((run) => safeRun(run, attempts.filter((attempt) => attempt.runId === run.id)));
}

export async function GET(request: Request) {
  try {
    assertLocalPaymentTestHost(request);
    const session = await requireMvpSession();
    const tester = assertPaymentTester(session);
    return json({
      runs: await listRuns(tester.userId),
      config: {
        amount: PAYMENT_TEST_CHARGE_AMOUNT,
        chargeCount: PAYMENT_TEST_CHARGE_COUNT,
        intervalSeconds: PAYMENT_TEST_INTERVAL_SECONDS,
        confirmation: PAYMENT_TEST_CONFIRMATION,
      },
    });
  } catch (error) {
    return paymentError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertLocalPaymentMutation(request);
    const session = await requireMvpSession();
    const tester = assertPaymentTester(session);
    const input = startSchema.parse(await request.json());
    const db = getDb();
    const run = await db.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${tester.userId}, 0))`;
      const duplicates = await tx`
        select
          r.id, r.registration_id, r.status, r.amount, r.interval_seconds,
          r.target_charge_count, r.succeeded_charge_count, r.next_charge_at,
          r.started_at, r.completed_at, r.stopped_at, r.created_at,
          p.card_last4, p.card_issuer
        from shorts_mvp.payment_test_recurring_runs r
        join shorts_mvp.payment_method_registrations p on p.id=r.registration_id
        where r.user_id=${tester.userId} and r.request_id=${input.requestId}
        limit 1
      ` as unknown as RunRow[];
      if (duplicates[0]) return duplicates[0];
      const openRuns = await tx`
        select id, status
        from shorts_mvp.payment_test_recurring_runs
        where user_id=${tester.userId} and status in ('running', 'unknown')
        limit 1
      `;
      if (openRuns[0]) {
        throw new PaymentTestAccessError(
          openRuns[0].status === "unknown"
            ? "승인 여부를 확인해야 하는 결제가 있습니다. PG 관리자 화면에서 확인하기 전에는 새 테스트를 시작할 수 없습니다."
            : "이미 진행 중인 반복결제 테스트가 있습니다.",
          409,
          openRuns[0].status === "unknown" ? "PAYMENT_OUTCOME_UNKNOWN" : "RUN_ALREADY_ACTIVE",
        );
      }
      const registrations = await tx`
        select id, card_issuer
        from shorts_mvp.payment_method_registrations
        where id=${input.registrationId}
          and user_id=${tester.userId}
          and status='active'
          and card_token_ciphertext is not null
          and card_token_iv is not null
          and card_token_tag is not null
        limit 1
      ` as unknown as RegistrationRow[];
      const registration = registrations[0];
      if (!registration) throw new PaymentTestAccessError("사용할 활성 카드 등록을 찾을 수 없습니다.", 404);
      if (isHanaCardIssuerName(registration.cardIssuer)) {
        throw new PaymentTestAccessError(
          "하나카드는 현재 반복결제 테스트에 사용할 수 없습니다. 다른 카드를 등록해 주세요.",
          422,
          "HANA_CARD_UNSUPPORTED",
        );
      }
      const rows = await tx`
        insert into shorts_mvp.payment_test_recurring_runs (
          user_id, registration_id, request_id, status, amount,
          interval_seconds, target_charge_count, payer_name, payer_email,
          payer_tel, next_charge_at
        ) values (
          ${tester.userId}, ${input.registrationId}, ${input.requestId}, 'running',
          ${PAYMENT_TEST_CHARGE_AMOUNT}, ${PAYMENT_TEST_INTERVAL_SECONDS},
          ${PAYMENT_TEST_CHARGE_COUNT}, ${input.payerName}, ${input.payerEmail},
          ${input.payerTel}, now()
        )
        returning
          id, registration_id, status, amount, interval_seconds,
          target_charge_count, succeeded_charge_count, next_charge_at,
          started_at, completed_at, stopped_at, created_at
      ` as unknown as RunRow[];
      return {
        ...rows[0],
        cardLast4: null,
        cardIssuer: registration.cardIssuer,
      };
    });
    return json({ run: safeRun(run) }, { status: 201 });
  } catch (error) {
    return paymentError(error);
  }
}
