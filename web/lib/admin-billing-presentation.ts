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

const paymentFailureCodeLabels: Record<string, string> = {
  "1023": "할부 이용 불가",
  "2012": "사용 불가 카드",
  "2015": "카드 유효기간 오류",
  "2021": "할부 개월 수 오류",
  "2041": "비밀번호 오류",
  "2044": "본인확인 정보 오류",
  "2061": "한도 초과",
  "2063": "한도 초과",
  "2070": "한도 초과",
  "2072": "거래 정지 카드",
  "2075": "잔액 부족",
  "9124": "카드번호 오류",
  "9999": "결제사 확인 필요",
  MANUAL_REVIEW_NO_APPROVAL: "승인 내역 없음",
  NETWORK_ERROR_PG_NOT_FOUND: "승인 내역 없음",
  PAYMENT_METHOD_REQUIRED: "결제수단 재등록 필요",
};

const paymentFailureDiagnosticLabels: Array<[RegExp, string]> = [
  [/잔액\s*부족|계좌잔액부족/i, "잔액 부족"],
  [/한도\s*초과|개인월간한도초과|구매\s*한도/i, "한도 초과"],
  [/비밀번호\s*오류.*회수\s*초과/i, "비밀번호 오류 횟수 초과"],
  [/비밀번호\s*오류/i, "비밀번호 오류"],
  [/주민번호|사업자번호|생년월일/i, "본인확인 정보 오류"],
  [/유효\s*기간|유효년수/i, "카드 유효기간 오류"],
  [/할부개월초과|할부\s*기간.*개월/i, "할부 개월 수 초과"],
  [/할부\s*개월\s*입력\s*오류/i, "할부 개월 수 오류"],
  [/할부\s*거래\s*불가능/i, "할부 이용 불가"],
  [/존재하지 않는 카드번호|카드번호\s*오류/i, "카드번호 오류"],
  [/거래정지\s*카드/i, "거래 정지 카드"],
  [/서비스\s*불가능\s*카드/i, "사용 불가 카드"],
  [/대상\s*조회\s*불가능/i, "결제 대상 조회 실패"],
  [/승인\s*없음|조회\s*결과\s*없음/i, "승인 내역 없음"],
  [/저장된\s*결제수단.*사용할\s*수\s*없/i, "결제수단 재등록 필요"],
  [/network|통신|timeout|시간\s*초과/i, "결제사 통신 오류"],
];

export function adminPaymentFailureLabel({
  failureCode,
  failureMessage,
}: {
  failureCode: string | null;
  failureMessage: string | null;
}) {
  const diagnostic = (failureMessage || "").replace(/\s+/g, " ").trim();
  for (const [pattern, label] of paymentFailureDiagnosticLabels) {
    if (pattern.test(diagnostic)) return label;
  }
  return failureCode ? paymentFailureCodeLabels[failureCode] || "결제사 확인 필요" : null;
}
