import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  assertThePayOneBillingEnabled,
  cardTokenHash,
  chargeThePayOneManualCard,
  createPaymentTrackId,
  thePayOneCardTypeAllowsInstallment,
  thePayOneMerchantId,
  thePayOnePackageBillingEnabled,
  thePayOneTerminalId,
  ThePayOneError,
} from "@/lib/thepayone";
import {
  assertLocalPaymentMutation,
  assertLocalPaymentTestHost,
  assertPaymentTester,
  PAYMENT_TEST_PACKAGE_SCENARIOS,
  paymentTestPackageScenarioNames,
  PaymentTestAccessError,
} from "@/lib/payment-test";
import {
  packageOrderColumns,
  packagePaymentError,
  paymentTestJson,
  safePackageOrder,
  type PaymentTestPackageOrderRow,
} from "@/lib/payment-test-package-orders";
import { requireMvpSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  requestId: z.string().uuid(),
  scenario: z.enum(paymentTestPackageScenarioNames),
  confirmation: z.string().max(100),
  payerName: z.string().trim().min(1).max(30),
  payerEmail: z.string().trim().email().max(100),
  payerTel: z.string()
    .transform((value) => value.replace(/[^0-9]/g, ""))
    .refine((value) => /^\d{10,11}$/.test(value)),
  cardNumber: z.string()
    .transform((value) => value.replace(/[^0-9]/g, ""))
    .refine((value) => /^\d{13,19}$/.test(value)),
  expiry: z.string().regex(/^\d{4}$/),
  identityNumber: z.string().regex(/^(\d{6}|\d{10})$/),
  cardPassword: z.string().regex(/^\d{2}$/),
}).strict();

function safeFailureMessage(error: unknown) {
  if (!(error instanceof Error)) return null;
  const diagnostic = error instanceof ThePayOneError && error.diagnostic
    ? ` · 상세: ${error.diagnostic}`
    : "";
  return `${error.message}${diagnostic}`
    .replace(/(?:\d[ -]?){6,19}/g, "[민감정보 숨김]")
    .slice(0, 300);
}

async function listPackageOrders(userId: string) {
  const rows = await getDb().unsafe<PaymentTestPackageOrderRow[]>(`
    select ${packageOrderColumns}
    from shorts_mvp.payment_test_package_orders
    where user_id=$1
    order by created_at desc
    limit 20
  `, [userId]);
  return rows.map(safePackageOrder);
}

export async function GET(request: Request) {
  try {
    assertLocalPaymentTestHost(request);
    const tester = assertPaymentTester(await requireMvpSession());
    const db = getDb();
    await db`
      update shorts_mvp.payment_test_package_orders
      set status=case when status='processing' then 'unknown' else status end,
        refund_status=case when refund_status='processing' then 'unknown' else refund_status end,
        failure_code=coalesce(failure_code,'PROCESS_INTERRUPTED'),
        failure_message=coalesce(
          failure_message,
          '처리 중단 가능성이 있어 PG 관리자 수동 대조가 필요합니다.'
        )
      where user_id=${tester.userId}
        and updated_at < now()-interval '2 minutes'
        and (status='processing' or refund_status='processing')
    `;
    return paymentTestJson({
      orders: await listPackageOrders(tester.userId),
      scenarios: PAYMENT_TEST_PACKAGE_SCENARIOS,
    });
  } catch (error) {
    return packagePaymentError(error);
  }
}

export async function POST(request: Request) {
  let order: PaymentTestPackageOrderRow | null = null;
  let duplicateRequest = false;
  let providerPaymentCompleted = false;
  let manualReviewRecorded = false;
  try {
    assertLocalPaymentMutation(request);
    const tester = assertPaymentTester(await requireMvpSession());
    assertThePayOneBillingEnabled();
    const input = createSchema.parse(await request.json());
    const scenario = PAYMENT_TEST_PACKAGE_SCENARIOS[input.scenario];
    if (input.confirmation !== scenario.chargeConfirmation) {
      throw new PaymentTestAccessError("실승인 확인 문구가 일치하지 않습니다.", 400);
    }
    if (!thePayOnePackageBillingEnabled()) {
      throw new PaymentTestAccessError(
        "패키지 결제 플래그가 꺼져 있습니다. 로컬에서만 활성화해 주세요.",
        503,
        "PACKAGE_BILLING_DISABLED",
      );
    }
    const credentialScope = "manual" as const;
    const merchantId = thePayOneMerchantId(credentialScope);
    const terminalId = thePayOneTerminalId(credentialScope);
    const db = getDb();
    order = await db.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${tester.userId},0))`;
      const duplicates = await tx`
        select ${tx.unsafe(packageOrderColumns)}
        from shorts_mvp.payment_test_package_orders
        where user_id=${tester.userId} and request_id=${input.requestId}
        limit 1
      ` as unknown as PaymentTestPackageOrderRow[];
      if (duplicates[0]) {
        duplicateRequest = true;
        return duplicates[0];
      }
      const open = await tx`
        select id,status,refund_status
        from shorts_mvp.payment_test_package_orders
        where user_id=${tester.userId}
          and (
            status in ('pending','processing','unknown','manual_review')
            or refund_status in ('processing','unknown','manual_review')
            or (status='succeeded' and refund_status='none')
          )
        limit 1
      `;
      if (open[0]) {
        throw new PaymentTestAccessError(
          "환불되지 않은 승인, PG 수동 대조 건 또는 처리 중인 패키지 테스트가 있습니다. 기존 거래를 먼저 전액환불·대조해 주세요.",
          409,
          "PACKAGE_PAYMENT_REVIEW_REQUIRED",
        );
      }
      const orderId = createPaymentTrackId("PAY");
      const rows = await tx`
        insert into shorts_mvp.payment_test_package_orders (
          user_id,registration_id,payment_input_mode,request_id,scenario,
          amount,installment_months,order_id,status,
          provider_merchant_id,provider_terminal_id
        ) values (
          ${tester.userId},null,'manual_direct',${input.requestId},${input.scenario},
          ${scenario.amount},${scenario.installmentMonths},${orderId},'processing',
          ${merchantId},${terminalId}
        )
        returning ${tx.unsafe(packageOrderColumns)}
      ` as unknown as PaymentTestPackageOrderRow[];
      return rows[0];
    });
    if (order.requestId !== input.requestId) {
      throw new PaymentTestAccessError("패키지 결제 요청 ID가 일치하지 않습니다.", 409);
    }
    if (duplicateRequest) {
      return paymentTestJson({ order: safePackageOrder(order), duplicate: true });
    }
    if (order.status !== "processing") {
      return paymentTestJson({ order: safePackageOrder(order), duplicate: true });
    }
    const payment = await chargeThePayOneManualCard({
      trackId: order.orderId,
      cardNumber: input.cardNumber,
      expiry: input.expiry,
      authDob: input.identityNumber,
      authPw: input.cardPassword,
      amount: scenario.amount,
      payerName: input.payerName,
      payerEmail: input.payerEmail,
      payerTel: input.payerTel,
      installmentMonths: scenario.installmentMonths,
      productName: scenario.label,
      description: "패키지 터미널 실승인 검증",
      referenceId: order.id,
    }, credentialScope);
    providerPaymentCompleted = true;
    const installmentCardTypeRejected = !thePayOneCardTypeAllowsInstallment(
      payment.cardType,
      scenario.installmentMonths,
    );
    const mismatchFields = [
      payment.trackId !== order.orderId ? "trackId" : null,
      payment.amount !== scenario.amount ? "amount" : null,
      payment.terminalId !== terminalId ? "terminalId" : null,
      payment.installmentMonths !== scenario.installmentMonths ? "installmentMonths" : null,
      installmentCardTypeRejected ? "cardType" : null,
    ].filter((field): field is string => Boolean(field));
    if (mismatchFields.length) {
      const failureCode = installmentCardTypeRejected
        ? "INSTALLMENT_CARD_TYPE_NOT_CREDIT"
        : "PAYMENT_MISMATCH";
      const rows = await db`
        update shorts_mvp.payment_test_package_orders
        set status='manual_review',provider_transaction_id=${payment.providerTransactionId},
          provider_auth_code=${payment.authCode},provider_result_code=${payment.resultCode},
          provider_response_amount=${payment.amount},
          provider_response_installment_months=${payment.installmentMonths},
          provider_response_issuer=${payment.issuer},
          provider_response_card_type=${payment.cardType},
          provider_response_card_last4=${payment.last4},
          provider_card_id_hash=${cardTokenHash(payment.cardId)},approved_at=${payment.approvedAt},
          failure_code=${failureCode},
          failure_message=${`응답 불일치: ${mismatchFields.join(",")}`}
        where id=${order.id} and user_id=${tester.userId} and status='processing'
        returning ${db.unsafe(packageOrderColumns)}
      ` as unknown as PaymentTestPackageOrderRow[];
      order = rows[0] || order;
      manualReviewRecorded = true;
      throw new PaymentTestAccessError(
        installmentCardTypeRejected
          ? "할부 승인은 발생했지만 신용카드 응답으로 확인되지 않아 중단했습니다. 자동 재시도하지 말고 PG 승인 대조 후 전액환불하세요."
          : "승인 응답이 요청과 달라 수동 대조 상태로 중단했습니다. 자동 재시도하지 마세요.",
        409,
        installmentCardTypeRejected
          ? "PACKAGE_INSTALLMENT_CARD_TYPE_REJECTED"
          : "PACKAGE_PAYMENT_MISMATCH",
      );
    }
    const rows = await db`
      update shorts_mvp.payment_test_package_orders
      set status='succeeded',provider_transaction_id=${payment.providerTransactionId},
        provider_auth_code=${payment.authCode},provider_result_code=${payment.resultCode},
        provider_response_amount=${payment.amount},
        provider_response_installment_months=${payment.installmentMonths},
        provider_response_issuer=${payment.issuer},
        provider_response_card_type=${payment.cardType},
        provider_response_card_last4=${payment.last4},
        provider_card_id_hash=${cardTokenHash(payment.cardId)},approved_at=${payment.approvedAt},
        failure_code=null,failure_message=null
      where id=${order.id} and user_id=${tester.userId} and status='processing'
      returning ${db.unsafe(packageOrderColumns)}
    ` as unknown as PaymentTestPackageOrderRow[];
    if (!rows[0]) {
      throw new PaymentTestAccessError(
        "승인은 완료됐지만 원장 확정에 실패했습니다. PG에서 수동 대조해 주세요.",
        409,
        "PACKAGE_LEDGER_CONFIRMATION_FAILED",
      );
    }
    return paymentTestJson({ order: safePackageOrder(rows[0]) }, { status: 201 });
  } catch (error) {
    if (order && !manualReviewRecorded) {
      const outcomeUnknown = providerPaymentCompleted
        || (error instanceof ThePayOneError && error.outcomeUnknown);
      await getDb()`
        update shorts_mvp.payment_test_package_orders
        set status=${outcomeUnknown ? "unknown" : "failed"},
          failure_code=${error instanceof ThePayOneError ? error.resultCode : "LOCAL_ERROR"},
          failure_message=${safeFailureMessage(error)}
        where id=${order.id} and status='processing'
      `.catch(() => undefined);
    }
    return packagePaymentError(error);
  }
}
