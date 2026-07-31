import type { MvpSession } from "@/lib/session";

export class PaymentTestAccessError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode: string | null = null,
  ) {
    super(message);
  }
}

export const PAYMENT_TEST_ONE_TIME_AMOUNT = 1000;
export const PAYMENT_TEST_CHARGE_AMOUNT = 1000;
export const PAYMENT_TEST_CHARGE_COUNT = 5;
export const PAYMENT_TEST_INTERVAL_SECONDS = 180;
export const PAYMENT_TEST_CONFIRMATION = "1,000원씩 5회 실제 결제";

export const paymentTestPackageScenarioNames = [
  "cash_1000",
  "installment_50000_3m",
] as const;

export type PaymentTestPackageScenarioName =
  (typeof paymentTestPackageScenarioNames)[number];

export const PAYMENT_TEST_PACKAGE_SCENARIOS = {
  cash_1000: {
    amount: 1_000,
    installmentMonths: 0,
    label: "1,000원 일시불",
    chargeConfirmation: "1,000원 일시불 실제 승인",
    refundConfirmation: "1,000원 전액환불",
  },
  installment_50000_3m: {
    amount: 50_000,
    installmentMonths: 3,
    label: "50,000원 3개월 할부",
    chargeConfirmation: "50,000원 3개월 할부 실제 승인",
    refundConfirmation: "50,000원 전액환불",
  },
} as const satisfies Record<
  PaymentTestPackageScenarioName,
  {
    amount: number;
    installmentMonths: number;
    label: string;
    chargeConfirmation: string;
    refundConfirmation: string;
  }
>;

export function paymentTestPackageScenario(name: PaymentTestPackageScenarioName) {
  return PAYMENT_TEST_PACKAGE_SCENARIOS[name];
}

export function isLocalHostname(hostname: string) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "0.0.0.0"
    || normalized === "::1";
}

export function isPaymentTestModeEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.PAYMENT_TEST_MODE === "true";
}

export function isPaymentTesterEmail(email: string | null | undefined) {
  if (!email) return false;
  const testers = (process.env.PAYMENT_TESTER_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return testers.includes(email.trim().toLowerCase());
}

function requestUrl(request: Request) {
  try {
    return new URL(request.url);
  } catch {
    throw new PaymentTestAccessError("요청 주소를 확인할 수 없습니다.", 400);
  }
}

function requestBrowserHost(request: Request) {
  const host = request.headers.get("host");
  if (!host) return requestUrl(request).host;
  try {
    const hostUrl = new URL(`http://${host}`);
    if (!isLocalHostname(hostUrl.hostname)) {
      throw new PaymentTestAccessError("로컬 Host 헤더가 아닌 요청은 차단됩니다.", 403);
    }
    return hostUrl.host;
  } catch (error) {
    if (error instanceof PaymentTestAccessError) throw error;
    throw new PaymentTestAccessError("Host 헤더가 올바르지 않습니다.", 403);
  }
}

export function assertLocalPaymentTestHost(request: Request) {
  if (!isPaymentTestModeEnabled()) {
    throw new PaymentTestAccessError("로컬 결제 테스트 모드가 꺼져 있습니다.", 404);
  }
  const url = requestUrl(request);
  if (!isLocalHostname(url.hostname)) {
    throw new PaymentTestAccessError("결제 테스트는 이 컴퓨터의 로컬 주소에서만 사용할 수 있습니다.", 403);
  }
  requestBrowserHost(request);
}

export function localPaymentTestOrigin(request: Request) {
  assertLocalPaymentTestHost(request);
  const url = requestUrl(request);
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const protocol = forwardedProtocol === "https" ? "https:" : url.protocol === "https:" ? "https:" : "http:";
  return new URL(`${protocol}//${requestBrowserHost(request)}`).origin;
}

export function assertLocalPaymentMutation(request: Request) {
  assertLocalPaymentTestHost(request);
  const origin = request.headers.get("origin");
  if (!origin) throw new PaymentTestAccessError("Origin 헤더가 없는 결제 요청은 차단됩니다.", 403);
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new PaymentTestAccessError("Origin 헤더가 올바르지 않습니다.", 403);
  }
  // Next.js can normalize request.url to the dev server bind address (0.0.0.0)
  // even when the browser is using localhost. The validated Host header reflects
  // the browser-visible origin, so compare against it without weakening CSRF checks.
  if (!isLocalHostname(originUrl.hostname) || originUrl.host !== requestBrowserHost(request)) {
    throw new PaymentTestAccessError("다른 출처에서 보낸 결제 요청은 차단됩니다.", 403);
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    throw new PaymentTestAccessError("동일 출처가 아닌 결제 요청은 차단됩니다.", 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new PaymentTestAccessError("JSON 형식의 결제 요청만 허용됩니다.", 415);
  }
}

export function assertPaymentTester(session: MvpSession) {
  if (!session.userId || !session.user?.email) {
    throw new PaymentTestAccessError("로그인이 필요합니다.", 401);
  }
  if (!isPaymentTesterEmail(session.user.email)) {
    throw new PaymentTestAccessError("허용된 테스트 계정이 아닙니다.", 403);
  }
  return { userId: session.userId, email: session.user.email };
}
