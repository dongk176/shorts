import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const DEFAULT_API_BASE_URL = "https://api.tosspayments.com";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 128 * 1024;

export class TossConfigurationError extends Error {}

export class TossApiError extends Error {
  constructor(
    message: string,
    readonly code = "TOSS_UPSTREAM_ERROR",
    readonly status = 502,
    readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = "TossApiError";
  }
}

type TossCard = {
  issuerCode?: string | null;
  acquirerCode?: string | null;
  number?: string | null;
  cardType?: string | null;
  ownerType?: string | null;
};

export type TossBillingAuthorization = {
  billingKey: string;
  customerKey: string;
  card?: TossCard | null;
};

export type TossPayment = {
  paymentKey: string;
  orderId: string;
  orderName: string;
  status: string;
  totalAmount: number;
  approvedAt?: string | null;
  card?: TossCard | null;
  method?: string | null;
};

export type EncryptedBillingKey = {
  ciphertext: string;
  iv: string;
  tag: string;
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new TossConfigurationError(`${name} 환경변수가 설정되지 않았습니다.`);
  return value;
}

function apiBaseUrl() {
  const raw = process.env.TOSS_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  let value: URL;
  try {
    value = new URL(raw);
  } catch {
    throw new TossConfigurationError("TOSS_API_BASE_URL 형식이 올바르지 않습니다.");
  }
  if (value.protocol !== "https:") throw new TossConfigurationError("Toss API는 HTTPS 주소만 사용할 수 있습니다.");
  return value.origin;
}

function encryptionKey() {
  const decoded = Buffer.from(requiredEnv("TOSS_BILLING_KEY_ENCRYPTION_KEY"), "base64");
  if (decoded.length !== 32) {
    throw new TossConfigurationError("TOSS_BILLING_KEY_ENCRYPTION_KEY는 32바이트 base64 값이어야 합니다.");
  }
  return decoded;
}

export function tossClientKey() {
  return requiredEnv("NEXT_PUBLIC_TOSS_CLIENT_KEY");
}

function basicAuthorization() {
  return `Basic ${Buffer.from(`${requiredEnv("TOSS_SECRET_KEY")}:`, "utf8").toString("base64")}`;
}

async function tossRequest<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(new URL(path, apiBaseUrl()), {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: basicAuthorization(),
        "Content-Type": "application/json",
        ...init.headers,
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof TossConfigurationError) throw error;
    throw new TossApiError("Toss 결제 서버의 응답을 확인하지 못했습니다.", "NETWORK_ERROR", 503, true);
  }
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_RESPONSE_BYTES) throw new TossApiError("Toss 응답 크기가 허용 범위를 초과했습니다.", "INVALID_RESPONSE");
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new TossApiError("Toss 응답 크기가 허용 범위를 초과했습니다.", "INVALID_RESPONSE");
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new TossApiError("Toss에서 올바른 JSON 응답을 받지 못했습니다.", "INVALID_RESPONSE", 502, response.status >= 500);
  }
  if (!response.ok) {
    const errorBody = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const code = typeof errorBody.code === "string" ? errorBody.code.slice(0, 80) : `HTTP_${response.status}`;
    const message = typeof errorBody.message === "string"
      ? errorBody.message.slice(0, 300)
      : "Toss 결제 요청이 승인되지 않았습니다.";
    throw new TossApiError(message, code, response.status, response.status >= 500);
  }
  return body as T;
}

export function encryptBillingKey(value: string): EncryptedBillingKey {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptBillingKey(value: EncryptedBillingKey) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function billingKeyHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function safeSecretEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function tossCardSummary(card: TossCard | null | undefined) {
  const masked = String(card?.number || "").replace(/[^0-9*]/g, "").slice(0, 32);
  const trailing = /([0-9]{4})$/.exec(masked)?.[1] || null;
  return {
    issuerCode: card?.issuerCode?.slice(0, 20) || null,
    cardNumberMasked: masked.length >= 4 ? masked : null,
    cardLast4: trailing,
    cardType: card?.cardType?.slice(0, 30) || null,
  };
}

export function issueBillingKey(authKey: string, customerKey: string) {
  return tossRequest<TossBillingAuthorization>("/v1/billing/authorizations/issue", {
    method: "POST",
    body: JSON.stringify({ authKey, customerKey }),
  });
}

export function chargeBillingKey(input: {
  billingKey: string;
  customerKey: string;
  amount: number;
  orderId: string;
  orderName: string;
  customerEmail?: string | null;
  customerName?: string | null;
}) {
  return tossRequest<TossPayment>(`/v1/billing/${encodeURIComponent(input.billingKey)}`, {
    method: "POST",
    body: JSON.stringify({
      customerKey: input.customerKey,
      amount: input.amount,
      orderId: input.orderId,
      orderName: input.orderName,
      customerEmail: input.customerEmail || undefined,
      customerName: input.customerName || undefined,
    }),
  });
}

export function confirmTossPayment(paymentKey: string, orderId: string, amount: number) {
  return tossRequest<TossPayment>("/v1/payments/confirm", {
    method: "POST",
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });
}

export function getTossPaymentByOrderId(orderId: string) {
  return tossRequest<TossPayment>(`/v1/payments/orders/${encodeURIComponent(orderId)}`, { method: "GET" });
}

export function deleteBillingKey(billingKey: string) {
  return tossRequest<Record<string, unknown>>(`/v1/billing/${encodeURIComponent(billingKey)}`, { method: "DELETE" });
}
