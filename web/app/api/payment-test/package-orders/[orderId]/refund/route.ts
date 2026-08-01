import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  createPaymentTrackId,
  PaymentConfigurationError,
  refundThePayOnePayment,
  thePayOneCredentialScopeForMerchantTerminal,
  thePayOneRefundMismatchFields,
  ThePayOneError,
} from "@/lib/thepayone";
import {
  assertLocalPaymentMutation,
  assertPaymentTester,
  PAYMENT_TEST_PACKAGE_SCENARIOS,
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

const refundSchema = z.object({
  requestId: z.string().uuid(),
  confirmation: z.string().max(100),
}).strict();

function safeFailureMessage(error: unknown) {
  if (!(error instanceof Error)) return null;
  return error.message.replace(/(?:\d[ -]?){6,19}/g, "[민감정보 숨김]").slice(0, 300);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  let order: PaymentTestPackageOrderRow | null = null;
  let duplicateRequest = false;
  let providerRefundCompleted = false;
  let manualReviewRecorded = false;
  try {
    assertLocalPaymentMutation(request);
    const tester = assertPaymentTester(await requireMvpSession());
    const orderId = z.string().uuid().parse((await context.params).orderId);
    const input = refundSchema.parse(await request.json());
    const db = getDb();
    order = await db.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${orderId},0))`;
      const rows = await tx`
        select ${tx.unsafe(packageOrderColumns)}
        from shorts_mvp.payment_test_package_orders
        where id=${orderId} and user_id=${tester.userId}
        for update
      ` as unknown as PaymentTestPackageOrderRow[];
      const current = rows[0];
      if (!current) throw new PaymentTestAccessError("환불할 패키지 테스트 주문을 찾을 수 없습니다.", 404);
      const scenario = PAYMENT_TEST_PACKAGE_SCENARIOS[current.scenario];
      if (input.confirmation !== scenario.refundConfirmation) {
        throw new PaymentTestAccessError("전액환불 확인 문구가 일치하지 않습니다.", 400);
      }
      if (current.refundRequestId === input.requestId && current.refundStatus !== "none") {
        duplicateRequest = true;
        return current;
      }
      const refundableRejectedInstallment = (
        current.status === "manual_review"
        && current.failureCode === "INSTALLMENT_CARD_TYPE_NOT_CREDIT"
      );
      if (
        (current.status !== "succeeded" && !refundableRejectedInstallment)
        || !current.providerTransactionId
      ) {
        throw new PaymentTestAccessError("승인이 확정된 주문만 전액환불할 수 있습니다.", 409);
      }
      if (current.refundStatus !== "none") {
        throw new PaymentTestAccessError(
          "이미 환불이 처리됐거나 PG 대조가 필요한 주문입니다. 자동 재시도하지 마세요.",
          409,
          "PACKAGE_REFUND_REVIEW_REQUIRED",
        );
      }
      const refundTrackId = createPaymentTrackId("REFUND");
      const updated = await tx`
        update shorts_mvp.payment_test_package_orders
        set refund_status='processing',refund_request_id=${input.requestId},
          refund_track_id=${refundTrackId}
        where id=${current.id} and refund_status='none'
        returning ${tx.unsafe(packageOrderColumns)}
      ` as unknown as PaymentTestPackageOrderRow[];
      return updated[0];
    });
    if (duplicateRequest) {
      return paymentTestJson({ order: safePackageOrder(order), duplicate: true });
    }
    if (!order.refundTrackId || !order.providerTransactionId) {
      throw new PaymentTestAccessError("환불 원장 정보가 올바르지 않습니다.", 409);
    }
    const credentialScope = thePayOneCredentialScopeForMerchantTerminal(
      order.providerMerchantId,
      order.providerTerminalId,
    );
    if (credentialScope !== "manual") {
      throw new PaymentConfigurationError("패키지 터미널 주문만 이 도구에서 환불할 수 있습니다.");
    }
    const refund = await refundThePayOnePayment({
      trackId: order.refundTrackId,
      rootTransactionId: order.providerTransactionId,
      amount: Number(order.amount),
      referenceId: order.id,
      reason: "패키지 터미널 실승인 전액환불",
    }, credentialScope);
    providerRefundCompleted = true;
    const mismatchFields = thePayOneRefundMismatchFields(refund, {
      trackId: order.refundTrackId,
      rootTransactionId: order.providerTransactionId,
      amount: Number(order.amount),
      terminalId: order.providerTerminalId,
    });
    if (mismatchFields.length) {
      const rows = await db`
        update shorts_mvp.payment_test_package_orders
        set refund_status='manual_review',
          refund_transaction_id=${refund.providerTransactionId},
          refund_result_code=${refund.resultCode},
          refund_response_amount=${refund.amount},
          refund_response_terminal_id=${refund.terminalId},
          refunded_at=${refund.refundedAt},
          failure_code='REFUND_MISMATCH',
          failure_message=${`환불 응답 불일치: ${mismatchFields.join(",")}`}
        where id=${order.id} and refund_status='processing'
        returning ${db.unsafe(packageOrderColumns)}
      ` as unknown as PaymentTestPackageOrderRow[];
      order = rows[0] || order;
      manualReviewRecorded = true;
      throw new PaymentTestAccessError(
        "환불 응답이 원승인과 달라 수동 대조 상태로 중단했습니다. 자동 재시도하지 마세요.",
        409,
        "PACKAGE_REFUND_MISMATCH",
      );
    }
    const rows = await db`
      update shorts_mvp.payment_test_package_orders
      set status=case
            when status='manual_review'
              and failure_code='INSTALLMENT_CARD_TYPE_NOT_CREDIT'
            then 'failed'
            else status
          end,
        refund_status='succeeded',
        refund_transaction_id=${refund.providerTransactionId},
        refund_result_code=${refund.resultCode},
        refund_response_amount=${refund.amount},
        refund_response_terminal_id=${refund.terminalId},
        refunded_at=${refund.refundedAt},
        failure_code=case
          when failure_code='INSTALLMENT_CARD_TYPE_NOT_CREDIT'
          then failure_code
          else null
        end,
        failure_message=case
          when failure_code='INSTALLMENT_CARD_TYPE_NOT_CREDIT'
          then '신용카드로 확인되지 않은 할부 승인 감지 후 전액환불 완료'
          else null
        end
      where id=${order.id} and refund_status='processing'
      returning ${db.unsafe(packageOrderColumns)}
    ` as unknown as PaymentTestPackageOrderRow[];
    if (!rows[0]) {
      throw new PaymentTestAccessError(
        "환불은 완료됐지만 원장 확정에 실패했습니다. PG에서 수동 대조해 주세요.",
        409,
        "PACKAGE_REFUND_LEDGER_FAILED",
      );
    }
    return paymentTestJson({ order: safePackageOrder(rows[0]) });
  } catch (error) {
    if (order && !manualReviewRecorded) {
      const outcomeUnknown = providerRefundCompleted
        || (error instanceof ThePayOneError && error.outcomeUnknown);
      await getDb()`
        update shorts_mvp.payment_test_package_orders
        set refund_status=${outcomeUnknown ? "unknown" : "failed"},
          failure_code=${error instanceof ThePayOneError ? error.resultCode : "LOCAL_ERROR"},
          failure_message=${safeFailureMessage(error)}
        where id=${order.id} and refund_status='processing'
      `.catch(() => undefined);
    }
    return packagePaymentError(error);
  }
}
