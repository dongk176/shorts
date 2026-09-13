export type ReferralSettlementMonth = {
  month: string;
  confirmedSalesKrw: number;
  waitingSalesKrw: number;
  futureSalesKrw: number;
  commissionKrw: number;
  reviewCount?: number;
  reviewReasons?: string[];
  excludedSalesKrw?: number;
};

export type ReferralSettlementSnapshot = ReferralSettlementMonth & {
  version: 1;
  capturedAt: string;
  periodStart: string;
  periodEnd: string;
  scheduledPaymentDate: string;
  refundAdjustmentKrw: number;
  payableKrw: number;
  installments: Array<{
    id: string; grossAmountKrw: number; recognizedAmountKrw: number;
    commissionAmountKrw: number; commissionRateBps: number;
  }>;
};

export type ReferralSettlementPayout = {
  id: string;
  month: string;
  status: "draft" | "paid";
  amountKrw: number;
  paidAt: string | null;
  snapshot: ReferralSettlementSnapshot | null;
};

export type ReferralSettlementTransaction = {
  id: string; memberEmail: string; productCode: string;
  approvedAt: string; earnedAt: string; availableAt: string;
  installmentNumber: number; installmentCount: number;
  grossAmountKrw: number; refundedAmountKrw: number; installmentGrossAmountKrw: number;
  recognizedAmountKrw: number; commissionAmountKrw: number; commissionRateBps: number;
  draftAmountKrw: number; paidAmountKrw: number; isAvailable: boolean;
  settlementMonth: string; scheduledPaymentDate: string;
  originalProductCode?: string; originalContractMonths?: number; eligibleInstallmentCount?: number;
  commissionBasisKrw?: number; excludedSalesKrw?: number; recognitionStatus?: string; recognitionReason?: string | null;
};

export type ReferralMonthlySettlement = ReferralSettlementMonth & {
  periodStart: string;
  periodEnd: string;
  scheduledPaymentDate: string;
  refundAdjustmentKrw: number;
  payableKrw: number;
  payableNow: boolean;
  overdue: boolean;
  status: "accruing" | "scheduled" | "unpaid" | "draft" | "paid" | "zero" | "review";
  payoutId: string | null;
  paidAt: string | null;
  draftChanged: boolean;
  currentPayableKrw: number;
  unallocatedRefundDebtKrw?: number;
};

export function referralKstDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

export function isSettlementMonth(value: string) {
  return /^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(value);
}

export function referralMonthPeriod(month: string) {
  if (!isSettlementMonth(month)) throw new Error("실적 월이 올바르지 않습니다.");
  const [year, number] = month.split("-").map(Number);
  return {
    periodStart: `${month}-01`,
    periodEnd: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10),
    scheduledPaymentDate: new Date(Date.UTC(year, number, 10)).toISOString().slice(0, 10),
  };
}

export function defaultReferralMonth(now = new Date()) {
  const [year, month] = referralKstDate(now).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 7);
}

export function resolveSettlementMonth(input: {
  settlementMonth?: string; periodStart?: string; periodEnd?: string;
}) {
  const month = input.settlementMonth ?? input.periodStart?.slice(0, 7) ?? "";
  const period = referralMonthPeriod(month);
  if ((input.periodStart && input.periodStart !== period.periodStart)
    || (input.periodEnd && input.periodEnd !== period.periodEnd)
    || (!input.settlementMonth && (!input.periodStart || !input.periodEnd))) {
    throw new Error("정산 기간은 실적 월의 1일부터 말일까지여야 합니다.");
  }
  return month;
}

export const referralSettlementStatusLabels: Record<ReferralMonthlySettlement["status"], string> = {
  accruing: "집계 중", scheduled: "지급 예정", unpaid: "미지급",
  draft: "송금 준비", paid: "지급 완료", zero: "지급액 없음", review: "정산 보류",
};

// Cash already paid/reserved is immutable. The difference from the CURRENT
// entitlement of those closed months is the remaining refund debt. A month
// paid net of an earlier refund supplies the matching credit, so that refund
// cannot be deducted again. Open months absorb debt oldest-first without
// moving their positive unpaid earnings into a different performance month.
export function buildReferralSettlements(
  months: ReferralSettlementMonth[], payouts: ReferralSettlementPayout[], now = new Date(),
  checkDrafts = true,
): ReferralMonthlySettlement[] {
  const today = referralKstDate(now);
  const monthMap = new Map(months.map((month) => [month.month, month]));
  for (const payout of payouts) {
    if (!monthMap.has(payout.month)) monthMap.set(payout.month, emptyReferralMonth(payout.month));
  }
  const payoutMap = new Map(payouts.map((payout) => [payout.month, payout]));
  let debt = Math.max(0, payouts.reduce((sum, payout) =>
    sum + payout.amountKrw - (monthMap.get(payout.month)?.commissionKrw ?? 0), 0));
  const result: ReferralMonthlySettlement[] = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)).map((month) => {
    const period = referralMonthPeriod(month.month);
    const due = today >= period.scheduledPaymentDate;
    const payout = payoutMap.get(month.month);
    const adjustment = !payout && due && !month.reviewCount ? Math.min(month.commissionKrw, debt) : 0;
    if (!payout && due) debt -= adjustment;
    const livePayable = Math.max(0, month.commissionKrw - adjustment);
    const snapshot = payout?.snapshot;
    const payable = payout ? payout.amountKrw : livePayable;
    const status: ReferralMonthlySettlement["status"] = payout?.status
      ?? (month.reviewCount ? "review" : month.month >= today.slice(0, 7) ? "accruing"
        : !due ? "scheduled" : payable > 0 ? "unpaid" : "zero");
    return {
      ...month,
      ...(snapshot ? {
        confirmedSalesKrw: snapshot.confirmedSalesKrw,
        waitingSalesKrw: snapshot.waitingSalesKrw,
        futureSalesKrw: snapshot.futureSalesKrw,
        commissionKrw: snapshot.commissionKrw,
      } : {}),
      ...period,
      refundAdjustmentKrw: snapshot?.refundAdjustmentKrw ?? adjustment,
      payableKrw: payable,
      currentPayableKrw: livePayable,
      payableNow: due && status === "unpaid" && payable > 0
        && !month.reviewCount && month.waitingSalesKrw === 0 && month.futureSalesKrw === 0,
      overdue: today > period.scheduledPaymentDate && (status === "unpaid" || status === "draft"),
      status,
      payoutId: payout?.id ?? null,
      paidAt: payout?.paidAt ?? null,
      draftChanged: false,
    };
  });
  for (const row of result) row.unallocatedRefundDebtKrw = debt;
  if (checkDrafts) {
    for (const row of result) {
      if (row.status !== "draft") continue;
      const current = buildReferralSettlements(months, payouts.filter((p) => p.id !== row.payoutId), now, false)
        .find((m) => m.month === row.month);
      row.currentPayableKrw = current?.payableKrw ?? 0;
      row.draftChanged = Boolean(row.reviewCount) || row.currentPayableKrw !== row.payableKrw
        || current?.commissionKrw !== row.commissionKrw;
    }
  }
  return result.reverse();
}

export function emptyReferralMonth(month: string): ReferralSettlementMonth {
  return { month, confirmedSalesKrw: 0, waitingSalesKrw: 0, futureSalesKrw: 0, commissionKrw: 0 };
}

export function referralRecognitionReasonLabel(reason: string | null | undefined) {
  const labels: Record<string, string> = {
    original_contract_unverified: "최초 결제 계약 확인 필요",
    original_contract_changed: "최초 계약과 결제 기록 불일치",
    conversion_period_unverified: "변경된 계약 기간 확인 필요",
    conversion_end_unverified: "변경된 이용 종료일 확인 필요",
    conversion_refund_unverified: "상품 변경 환불액 확인 필요",
    conversion_refund_pending: "상품 변경 차액 환불 미완료",
    conversion_evidence_missing: "상품 변경 근거 확인 필요",
    conversion_evidence_invalid: "상품 변경 기록 확인 필요",
  };
  return labels[reason ?? ""] ?? "계약·환불 확인 필요";
}
