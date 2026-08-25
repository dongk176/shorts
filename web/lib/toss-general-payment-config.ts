export class TossGeneralPaymentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TossGeneralPaymentConfigurationError";
  }
}

function enabled(name: string) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new TossGeneralPaymentConfigurationError(
      `${name} 환경변수가 설정되지 않았습니다.`,
    );
  }
  return value;
}

export function tossGeneralPaymentEnabled() {
  return enabled("TOSS_GENERAL_PAYMENT_ENABLED");
}

export function assertTossGeneralPaymentEnabled() {
  if (!tossGeneralPaymentEnabled()) {
    throw new TossGeneralPaymentConfigurationError(
      "기업 일반결제 기능이 활성화되지 않았습니다.",
    );
  }
}

export function tossGeneralPaymentKeys() {
  assertTossGeneralPaymentEnabled();
  const clientKey = required("NEXT_PUBLIC_TOSS_CLIENT_KEY");
  const secretKey = required("TOSS_SECRET_KEY");
  if (!/^(?:live|test)_gck_/.test(clientKey)) {
    throw new TossGeneralPaymentConfigurationError(
      "주문서형·결제창형 토스 클라이언트 키가 올바르지 않습니다.",
    );
  }
  if (!/^(?:live|test)_gsk_/.test(secretKey)) {
    throw new TossGeneralPaymentConfigurationError(
      "주문서형·결제창형 토스 시크릿 키가 올바르지 않습니다.",
    );
  }
  if (clientKey.startsWith("live_") !== secretKey.startsWith("live_")) {
    throw new TossGeneralPaymentConfigurationError(
      "토스 일반결제 클라이언트 키와 시크릿 키의 환경이 일치하지 않습니다.",
    );
  }
  return { clientKey, secretKey };
}

export function tossGeneralPaymentApiBaseUrl() {
  return "https://api.tosspayments.com";
}
