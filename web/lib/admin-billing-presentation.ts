export type AdminPaymentPresentationInput = {
  provider: string;
  providerTerminalId: string | null;
  hasPaymentMethod: boolean;
  credentialScope: string | null;
  installmentMonths: number;
  cardIssuerName: string | null;
  installmentBenefitType: string | null;
  declaredCardKind: string | null;
};

export function adminPaymentFlowLabel(order: AdminPaymentPresentationInput) {
  if (order.provider !== "thepayone") return null;
  if (
    order.credentialScope === "manual"
    || order.providerTerminalId === "arti02"
  ) return "수기결제";
  if (order.hasPaymentMethod) return "저장카드";
  if (order.providerTerminalId === "arti01") return "정기결제";
  return null;
}

export function adminCardKindLabel(value: string | null) {
  if (value === "credit") return "신용카드";
  if (value === "cash") return "체크·선불카드";
  return null;
}

export function adminInstallmentLabel(months: number) {
  return months > 0 ? `${months}개월 할부` : "일시불";
}

export function adminInstallmentBenefitLabel(value: string | null) {
  if (value === "interest_free") return "무이자";
  if (value === "partial_interest_free") return "부분 무이자";
  if (value === "standard_interest") return "일반 할부";
  return null;
}

export function adminPaymentDetailParts(order: AdminPaymentPresentationInput) {
  const cardKind = adminCardKindLabel(order.declaredCardKind);
  const benefit = order.installmentMonths > 0
    ? adminInstallmentBenefitLabel(order.installmentBenefitType)
    : null;
  return [
    order.cardIssuerName,
    cardKind,
    adminInstallmentLabel(order.installmentMonths),
    benefit,
  ].filter((value): value is string => Boolean(value));
}
