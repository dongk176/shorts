export class TossBillingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TossBillingConfigurationError";
  }
}
function enabled(name: string) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new TossBillingConfigurationError(`${name} 환경변수가 설정되지 않았습니다.`);
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
  return required("NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY");
}

export function tossBillingSecretKey() {
  assertTossBillingChargesEnabled();
  return required("TOSS_BILLING_SECRET_KEY");
}

export function tossBillingApiBaseUrl() {
  return "https://api.tosspayments.com";
}
