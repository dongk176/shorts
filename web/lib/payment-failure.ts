export type PaymentCorrectionField =
  | "cardNumber"
  | "expiryMonth"
  | "cardPassword"
  | "identityNumber"
  | "installments";

export type UserPaymentFailure = {
  code: string;
  title: string;
  detail: string;
  field: PaymentCorrectionField | null;
};

const failures = {
  identity: {
    code: "PAYMENT_IDENTITY_INVALID",
    title: "본인확인 정보를 확인해 주세요",
    detail: "본인확인 정보가 카드사 등록정보와 일치하지 않습니다. 개인카드는 생년월일 6자리, 법인카드는 사업자번호 10자리를 확인해 주세요.",
    field: "identityNumber",
  },
  password: {
    code: "PAYMENT_CARD_PASSWORD_INVALID",
    title: "카드 비밀번호를 확인해 주세요",
    detail: "카드 비밀번호 앞 2자리가 일치하지 않습니다. 다시 확인해 주세요.",
    field: "cardPassword",
  },
  expiry: {
    code: "PAYMENT_CARD_EXPIRY_INVALID",
    title: "카드 유효기간을 확인해 주세요",
    detail: "카드 유효기간이 일치하지 않습니다. 카드에 표시된 월과 연도를 다시 확인해 주세요.",
    field: "expiryMonth",
  },
  cardNumber: {
    code: "PAYMENT_CARD_NUMBER_INVALID",
    title: "카드번호를 확인해 주세요",
    detail: "카드번호가 올바르지 않습니다. 카드번호를 다시 확인해 주세요.",
    field: "cardNumber",
  },
  installment: {
    code: "PAYMENT_INSTALLMENT_INVALID",
    title: "할부 정보를 확인해 주세요",
    detail: "선택한 할부 개월수로 결제할 수 없습니다. 다른 할부 개월수 또는 일시불을 선택해 주세요.",
    field: "installments",
  },
  limit: {
    code: "PAYMENT_LIMIT_EXCEEDED",
    title: "카드 한도를 확인해 주세요",
    detail: "카드 한도를 초과해 결제가 승인되지 않았습니다. 카드 한도를 확인하거나 다른 카드를 이용해 주세요.",
    field: null,
  },
  balance: {
    code: "PAYMENT_BALANCE_INSUFFICIENT",
    title: "결제 계좌 잔액을 확인해 주세요",
    detail: "결제 계좌의 잔액이 부족해 승인이 거절되었습니다. 잔액을 확인하거나 다른 카드를 이용해 주세요.",
    field: null,
  },
  unavailable: {
    code: "PAYMENT_CARD_UNAVAILABLE",
    title: "다른 카드를 이용해 주세요",
    detail: "카드사에서 이 카드의 결제를 승인하지 않았습니다. 카드 상태를 확인하거나 다른 카드를 이용해 주세요.",
    field: "cardNumber",
  },
  provider: {
    code: "PAYMENT_PROVIDER_REJECTED",
    title: "카드사에서 결제를 승인하지 않았습니다",
    detail: "입력한 카드 정보를 확인하거나 다른 카드를 이용해 주세요. 결제 금액은 청구되지 않았습니다.",
    field: null,
  },
} as const satisfies Record<string, UserPaymentFailure>;

const failureByProviderCode: Record<string, UserPaymentFailure> = {
  "1023": failures.installment,
  "2012": failures.unavailable,
  "2015": failures.expiry,
  "2021": failures.installment,
  "2041": failures.password,
  "2044": failures.identity,
  "2061": failures.limit,
  "2063": failures.limit,
  "2070": failures.limit,
  "2072": failures.unavailable,
  "2075": failures.balance,
  "9124": failures.cardNumber,
};

const failureByPublicCode = new Map<string, UserPaymentFailure>(
  Object.values(failures).map((failure) => [failure.code, failure]),
);

const diagnosticFailures: Array<[RegExp, UserPaymentFailure]> = [
  [/주민번호|사업자번호|생년월일/i, failures.identity],
  [/비밀번호/i, failures.password],
  [/유효\s*기간|유효년수/i, failures.expiry],
  [/존재하지 않는 카드번호|카드번호\s*오류/i, failures.cardNumber],
  [/할부개월초과|할부\s*기간.*개월|할부\s*개월\s*입력\s*오류|할부\s*거래\s*불가능/i, failures.installment],
  [/한도\s*초과|개인월간한도초과|구매\s*한도/i, failures.limit],
  [/잔액\s*부족|계좌잔액부족/i, failures.balance],
  [/거래정지\s*카드|서비스\s*불가능\s*카드/i, failures.unavailable],
];

export function thePayOneUserPaymentFailure(
  providerCode: string | null | undefined,
  diagnostic: string | null | undefined,
): UserPaymentFailure {
  const normalizedDiagnostic = (diagnostic || "").replace(/\s+/g, " ").trim();
  for (const [pattern, failure] of diagnosticFailures) {
    if (pattern.test(normalizedDiagnostic)) return failure;
  }
  return (providerCode && failureByProviderCode[providerCode]) || failures.provider;
}

export function userPaymentFailureForCode(
  code: string | null | undefined,
): UserPaymentFailure | null {
  return code ? failureByPublicCode.get(code) || null : null;
}
