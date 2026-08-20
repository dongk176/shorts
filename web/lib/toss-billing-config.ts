export class TossBillingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TossBillingConfigurationError";
  }
}
function enabled(name: string) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function requiredAny(...names: string[]) {
  const value = names
    .map((name) => process.env[name]?.trim())
    .find((candidate): candidate is string => Boolean(candidate));
  if (!value) {
    throw new TossBillingConfigurationError(
      `${names.join(" 또는 ")} 환경변수가 설정되지 않았습니다.`,
    );
  }
  return value;
}

export function tossBillingEnabled() {
  return enabled("TOSS_BILLING_ENABLED");
}

export function tossBillingChargesEnabled() {
  return tossBillingEnabled() && enabled("TOSS_BILLING_CHARGES_ENABLED");
}

export function tossBillingRenewalsEnabled() {
  return tossBillingChargesEnabled() && enabled("TOSS_BILLING_RENEWALS_ENABLED");
}

export function tossBillingCohortAssignmentEnabled() {
  return tossBillingEnabled()
    && enabled("TOSS_BILLING_COHORT_ASSIGNMENT_ENABLED");
}

export function assertTossBillingEnabled() {
  if (!tossBillingEnabled()) {
    throw new TossBillingConfigurationError("토스 빌링 기능이 활성화되지 않았습니다.");
  }
}

export function assertTossBillingChargesEnabled() {
  if (!tossBillingChargesEnabled()) {
    throw new TossBillingConfigurationError("토스 빌링 청구 기능이 활성화되지 않았습니다.");
  }
}

export function assertTossBillingRenewalsEnabled() {
  if (!tossBillingRenewalsEnabled()) {
    throw new TossBillingConfigurationError("토스 빌링 정기청구 기능이 활성화되지 않았습니다.");
  }
}

export function tossBillingClientKey() {
  assertTossBillingEnabled();
  return requiredAny(
    "NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY",
    "NEXT_PUBLIC_TOSS_CLIENT_KEY",
  );
}

export function tossBillingSecretKey() {
  assertTossBillingChargesEnabled();
  return requiredAny("TOSS_BILLING_SECRET_KEY", "TOSS_SECRET_KEY");
}

export function tossBillingCheckoutKeys() {
  const clientKey = tossBillingClientKey();
  const secretKey = tossBillingSecretKey();
  if (!/^(?:live|test)_ck_/.test(clientKey) || !/^(?:live|test)_sk_/.test(secretKey)) {
    throw new TossBillingConfigurationError(
      "토스 자동결제용 API 개별 연동 키가 설정되지 않았습니다.",
    );
  }
  if (clientKey.startsWith("live_") !== secretKey.startsWith("live_")) {
    throw new TossBillingConfigurationError(
      "토스 자동결제 클라이언트 키와 시크릿 키의 환경이 일치하지 않습니다.",
    );
  }
  return { clientKey, secretKey };
}

export function tossBillingApiBaseUrl() {
  return "https://api.tosspayments.com";
}
