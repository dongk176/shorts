export const adminRefundReasonCodes = [
  "customer_early_termination",
  "statutory_withdrawal_unused",
  "company_fault",
  "duplicate_or_mistaken_payment",
  "goodwill",
] as const;

export type AdminRefundReasonCode = (typeof adminRefundReasonCodes)[number];

export type CustomerEarlyTerminationQuote = {
  elapsedServiceKrw: number;
  remainingServiceKrw: number;
  penaltyKrw: number;
  policyRefundTotalKrw: number;
  refundAmountKrw: number;
  elapsedDays: number;
  totalDays: number;
  withinSevenDays: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;

function validDate(value: Date) {
  return Number.isFinite(value.getTime());
}

export function quoteCustomerEarlyTerminationRefund(input: {
  actualPaymentKrw: number;
  refundedOrReservedKrw?: number;
  periodStart: Date;
  periodEnd: Date;
  requestedAt?: Date;
}): CustomerEarlyTerminationQuote {
  const {
    actualPaymentKrw,
    periodStart,
    periodEnd,
    requestedAt = new Date(),
  } = input;
  const refundedOrReservedKrw = input.refundedOrReservedKrw || 0;
  if (!Number.isSafeInteger(actualPaymentKrw) || actualPaymentKrw < 0) {
    throw new Error("실 결제금액이 올바르지 않습니다.");
  }
  if (!Number.isSafeInteger(refundedOrReservedKrw) || refundedOrReservedKrw < 0) {
    throw new Error("기존 환불금액이 올바르지 않습니다.");
  }
  if (!validDate(periodStart) || !validDate(periodEnd) || !validDate(requestedAt)) {
    throw new Error("계약기간이 올바르지 않습니다.");
  }

  const totalMs = periodEnd.getTime() - periodStart.getTime();
  if (totalMs <= 0) throw new Error("계약 종료일은 시작일보다 뒤여야 합니다.");
  const elapsedMs = Math.min(
    totalMs,
    Math.max(0, requestedAt.getTime() - periodStart.getTime()),
  );
  const elapsedServiceKrw = Math.floor(actualPaymentKrw * (elapsedMs / totalMs));
  const remainingServiceKrw = Math.max(0, actualPaymentKrw - elapsedServiceKrw);
  const withinSevenDays = requestedAt.getTime() <= periodStart.getTime() + SEVEN_DAYS_MS;
  const penaltyKrw = withinSevenDays ? 0 : Math.floor(remainingServiceKrw * 0.1);
  const policyRefundTotalKrw = Math.max(0, remainingServiceKrw - penaltyKrw);

  return {
    elapsedServiceKrw,
    remainingServiceKrw,
    penaltyKrw,
    policyRefundTotalKrw,
    refundAmountKrw: Math.max(0, policyRefundTotalKrw - refundedOrReservedKrw),
    elapsedDays: elapsedMs / DAY_MS,
    totalDays: totalMs / DAY_MS,
    withinSevenDays,
  };
}

export function adminRefundReasonLabel(code: AdminRefundReasonCode) {
  const labels: Record<AdminRefundReasonCode, string> = {
    customer_early_termination: "고객 귀책 즉시 중도해지",
    statutory_withdrawal_unused: "7일 이내 미사용 청약철회",
    company_fault: "회사 귀책·서비스 하자",
    duplicate_or_mistaken_payment: "중복·오결제",
    goodwill: "예외적 호의 환불",
  };
  return labels[code];
}
