import { NextResponse } from "next/server";
import { z } from "zod";
import {
  PaymentConfigurationError,
  ThePayOneError,
} from "@/lib/thepayone";
import {
  PAYMENT_TEST_PACKAGE_SCENARIOS,
  PaymentTestAccessError,
} from "@/lib/payment-test";

type PackageOrderStatus =
  "pending" | "processing" | "succeeded" | "failed" | "unknown" | "manual_review";
type RefundStatus =
  "none" | "processing" | "succeeded" | "failed" | "unknown" | "manual_review";

export type PaymentTestPackageOrderRow = {
  id: string;
  registrationId: string | null;
  paymentInputMode: "registered_card" | "manual_direct";
  requestId: string;
  scenario: keyof typeof PAYMENT_TEST_PACKAGE_SCENARIOS;
  amount: number;
  installmentMonths: number;
  orderId: string;
  status: PackageOrderStatus;
  providerMerchantId: string;
  providerTerminalId: string;
  providerTransactionId: string | null;
  providerAuthCode: string | null;
  providerResultCode: string | null;
  providerResponseAmount: number | null;
  providerResponseInstallmentMonths: number | null;
  providerResponseIssuer: string | null;
  providerResponseCardType: string | null;
  providerResponseCardLast4: string | null;
  approvedAt: Date | null;
  refundStatus: RefundStatus;
  refundRequestId: string | null;
  refundTrackId: string | null;
  refundTransactionId: string | null;
  refundResultCode: string | null;
  refundResponseAmount: number | null;
  refundResponseTerminalId: string | null;
  refundedAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export const packageOrderColumns = `
  id,registration_id,payment_input_mode,request_id,scenario,amount,installment_months,order_id,status,
  provider_merchant_id,provider_terminal_id,provider_transaction_id,provider_auth_code,
  provider_result_code,provider_response_amount,provider_response_installment_months,
  provider_response_issuer,provider_response_card_type,provider_response_card_last4,
  approved_at,refund_status,refund_request_id,refund_track_id,refund_transaction_id,refund_result_code,
  refund_response_amount,refund_response_terminal_id,refunded_at,failure_code,
  failure_message,created_at,updated_at
`;

export function safePackageOrder(row: PaymentTestPackageOrderRow) {
  return {
    id: row.id,
    registrationId: row.registrationId,
    paymentInputMode: row.paymentInputMode,
    scenario: row.scenario,
    label: PAYMENT_TEST_PACKAGE_SCENARIOS[row.scenario].label,
    amount: Number(row.amount),
    installmentMonths: Number(row.installmentMonths),
    orderId: row.orderId,
    status: row.status,
    merchantId: row.providerMerchantId,
    terminalId: row.providerTerminalId,
    transactionId: row.providerTransactionId,
    authCode: row.providerAuthCode,
    resultCode: row.providerResultCode,
    responseAmount: row.providerResponseAmount === null
      ? null
      : Number(row.providerResponseAmount),
    responseInstallmentMonths: row.providerResponseInstallmentMonths === null
      ? null
      : Number(row.providerResponseInstallmentMonths),
    responseIssuer: row.providerResponseIssuer,
    responseCardType: row.providerResponseCardType,
    responseCardLast4: row.providerResponseCardLast4,
    approvedAt: row.approvedAt?.toISOString() || null,
    refundStatus: row.refundStatus,
    refundTrackId: row.refundTrackId,
    refundTransactionId: row.refundTransactionId,
    refundResultCode: row.refundResultCode,
    refundResponseAmount: row.refundResponseAmount === null
      ? null
      : Number(row.refundResponseAmount),
    refundResponseTerminalId: row.refundResponseTerminalId,
    refundedAt: row.refundedAt?.toISOString() || null,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function paymentTestJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export function packagePaymentError(error: unknown) {
  if (error instanceof PaymentTestAccessError) {
    return paymentTestJson(
      { detail: error.message, errorCode: error.errorCode },
      { status: error.status },
    );
  }
  if (error instanceof PaymentConfigurationError) {
    return paymentTestJson({ detail: error.message }, { status: 503 });
  }
  if (error instanceof ThePayOneError) {
    return paymentTestJson({
      detail: error.outcomeUnknown
        ? "승인 결과를 확정하지 못했습니다. 자동 재시도하지 말고 더페이원 관리자에서 거래를 확인해 주세요."
        : error.diagnostic
          ? `${error.message} · 상세: ${error.diagnostic}`
          : error.message,
      errorCode: error.outcomeUnknown ? "PAYMENT_OUTCOME_UNKNOWN" : "PAYMENT_FAILED",
      resultCode: error.resultCode,
    }, { status: 502 });
  }
  if (error instanceof z.ZodError) {
    return paymentTestJson(
      { detail: "패키지 승인 시나리오와 카드 인증값을 확인해 주세요." },
      { status: 400 },
    );
  }
  return paymentTestJson(
    { detail: "패키지 수기결제 테스트를 처리하지 못했습니다." },
    { status: 500 },
  );
}
