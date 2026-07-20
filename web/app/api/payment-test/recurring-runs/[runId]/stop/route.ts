import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  assertLocalPaymentMutation,
  assertPaymentTester,
  PaymentTestAccessError,
} from "@/lib/payment-test";
import { requireMvpSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
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
    const db = getDb();
    const rows = await db`
      update shorts_mvp.payment_test_recurring_runs
      set
        status='stopped', stopped_at=now(), next_charge_at=null,
        payer_name=null, payer_email=null, payer_tel=null
      where id=${runId} and user_id=${tester.userId} and status='running'
      returning id, status, stopped_at
    `;
    if (!rows[0]) {
      const existing = await db`
        select status from shorts_mvp.payment_test_recurring_runs
        where id=${runId} and user_id=${tester.userId}
        limit 1
      `;
      if (existing[0]?.status === "unknown") {
        throw new PaymentTestAccessError(
          "승인 여부가 불명확한 회차는 PG 관리자 화면에서 확인하기 전까지 종료 처리할 수 없습니다.",
          409,
          "PAYMENT_OUTCOME_UNKNOWN",
        );
      }
      throw new PaymentTestAccessError("중단할 진행 중 테스트를 찾을 수 없습니다.", 404);
    }
    return json({ run: rows[0] });
  } catch (error) {
    if (error instanceof PaymentTestAccessError) {
      return json({ detail: error.message, errorCode: error.errorCode }, { status: error.status });
    }
    if (error instanceof z.ZodError) return json({ detail: "반복결제 테스트 ID가 올바르지 않습니다." }, { status: 400 });
    return json({ detail: "반복결제 테스트 중단을 처리하지 못했습니다." }, { status: 500 });
  }
}
