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

export type PrepaidPackageMonthState = {
  completedMonths: number;
  currentMonthNumber: number | null;
  currentMonthStart: Date | null;
  currentMonthEnd: Date | null;
};

export type PrepaidPackageRefundQuote = {
  monthlyUnitKrw: number;
  completedMonths: number;
  currentMonthNumber: number | null;
  currentMonthUsed: boolean;
  chargedMonths: number;
  providedServiceKrw: number;
  remainingServiceKrw: number;
  policyRefundTotalKrw: number;
  refundAmountKrw: number;
  entitlementEndsAt: Date;
  withinSevenDays: boolean;
};

export type FirstCompletedJobRefundQuote = {
  actualPaymentKrw: number;
  refundedOrReservedKrw: number;
  prepaidMonths: number;
  firstJobCompleted: boolean;
  monthlyDeductionKrw: number;
  policyRefundTotalKrw: number;
  refundAmountKrw: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;

function validDate(value: Date) {
  return Number.isFinite(value.getTime());
}

function addKstMonths(date: Date, months: number) {
  const offset = 9 * 60 * 60 * 1000;
  const kst = new Date(date.getTime() + offset);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth() + months;
  const day = kst.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const shifted = new Date(Date.UTC(
    year,
    month,
    Math.min(day, lastDay),
    kst.getUTCHours(),
    kst.getUTCMinutes(),
    kst.getUTCSeconds(),
    kst.getUTCMilliseconds(),
  ));
  return new Date(shifted.getTime() - offset);
}

export function getPrepaidPackageMonthState(input: {
  periodStart: Date;
  prepaidMonths: number;
  requestedAt?: Date;
}): PrepaidPackageMonthState {
  const { periodStart, prepaidMonths, requestedAt = new Date() } = input;
  if (!validDate(periodStart) || !validDate(requestedAt)) {
    throw new Error("패키지 이용기간이 올바르지 않습니다.");
  }
  if (!Number.isSafeInteger(prepaidMonths) || prepaidMonths < 1 || prepaidMonths > 120) {
    throw new Error("패키지 개월 수가 올바르지 않습니다.");
  }

  let completedMonths = 0;
  while (
    completedMonths < prepaidMonths
    && addKstMonths(periodStart, completedMonths + 1).getTime() <= requestedAt.getTime()
  ) {
    completedMonths += 1;
  }
  if (completedMonths >= prepaidMonths) {
    return {
      completedMonths: prepaidMonths,
      currentMonthNumber: null,
      currentMonthStart: null,
      currentMonthEnd: null,
    };
  }

  return {
    completedMonths,
    currentMonthNumber: completedMonths + 1,
    currentMonthStart: addKstMonths(periodStart, completedMonths),
    currentMonthEnd: addKstMonths(periodStart, completedMonths + 1),
  };
}

export function quotePrepaidPackageRefund(input: {
  actualPaymentKrw: number;
  refundedOrReservedKrw?: number;
  periodStart: Date;
  prepaidMonths: number;
  currentMonthUsed: boolean;
  requestedAt?: Date;
}): PrepaidPackageRefundQuote {
  const {
    actualPaymentKrw,
    periodStart,
    prepaidMonths,
    currentMonthUsed,
    requestedAt = new Date(),
  } = input;
  const refundedOrReservedKrw = input.refundedOrReservedKrw || 0;
  if (!Number.isSafeInteger(actualPaymentKrw) || actualPaymentKrw < 0) {
    throw new Error("실 결제금액이 올바르지 않습니다.");
  }
  if (!Number.isSafeInteger(refundedOrReservedKrw) || refundedOrReservedKrw < 0) {
    throw new Error("기존 환불금액이 올바르지 않습니다.");
  }

  const monthState = getPrepaidPackageMonthState({
    periodStart,
    prepaidMonths,
    requestedAt,
  });
  const chargeCurrentMonth = monthState.currentMonthNumber !== null && currentMonthUsed;
  const chargedMonths = Math.min(
    prepaidMonths,
    monthState.completedMonths + (chargeCurrentMonth ? 1 : 0),
  );
  const providedServiceKrw = Math.floor(
    actualPaymentKrw * (chargedMonths / prepaidMonths),
  );
  const remainingServiceKrw = Math.max(0, actualPaymentKrw - providedServiceKrw);
  const entitlementEndsAt = chargeCurrentMonth && monthState.currentMonthEnd
    ? monthState.currentMonthEnd
    : requestedAt;
  const withinSevenDays = requestedAt.getTime() <= periodStart.getTime() + SEVEN_DAYS_MS;

  return {
    monthlyUnitKrw: Math.floor(actualPaymentKrw / prepaidMonths),
    completedMonths: monthState.completedMonths,
    currentMonthNumber: monthState.currentMonthNumber,
    currentMonthUsed: chargeCurrentMonth,
    chargedMonths,
    providedServiceKrw,
    remainingServiceKrw,
    policyRefundTotalKrw: remainingServiceKrw,
    refundAmountKrw: Math.max(0, remainingServiceKrw - refundedOrReservedKrw),
    entitlementEndsAt,
    withinSevenDays,
  };
}

export function quoteFirstCompletedJobRefund(input: {
  actualPaymentKrw: number;
  refundedOrReservedKrw?: number;
  prepaidMonths: number;
  firstJobCompleted: boolean;
}): FirstCompletedJobRefundQuote {
  const refundedOrReservedKrw = input.refundedOrReservedKrw || 0;
  if (!Number.isSafeInteger(input.actualPaymentKrw) || input.actualPaymentKrw < 0) {
    throw new Error("실 결제금액이 올바르지 않습니다.");
  }
  if (!Number.isSafeInteger(refundedOrReservedKrw) || refundedOrReservedKrw < 0) {
    throw new Error("기존 환불금액이 올바르지 않습니다.");
  }
  if (
    !Number.isSafeInteger(input.prepaidMonths)
    || input.prepaidMonths < 1
    || input.prepaidMonths > 120
  ) {
    throw new Error("상품 개월 수가 올바르지 않습니다.");
  }

  const monthlyDeductionKrw = input.firstJobCompleted
    ? Math.floor(input.actualPaymentKrw / input.prepaidMonths)
    : 0;
  const policyRefundTotalKrw = Math.max(
    0,
    input.actualPaymentKrw - monthlyDeductionKrw,
  );

  return {
    actualPaymentKrw: input.actualPaymentKrw,
    refundedOrReservedKrw,
    prepaidMonths: input.prepaidMonths,
    firstJobCompleted: input.firstJobCompleted,
    monthlyDeductionKrw,
    policyRefundTotalKrw,
    refundAmountKrw: Math.max(0, policyRefundTotalKrw - refundedOrReservedKrw),
  };
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
