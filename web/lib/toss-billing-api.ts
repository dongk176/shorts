import { setTimeout as delay } from "node:timers/promises";
import {
  assertTossBillingEnabled,
  assertTossBillingChargesEnabled,
  tossBillingApiBaseUrl,
  tossBillingApiSecretKey,
  tossBillingSecretKey,
} from "@/lib/toss-billing-config";

const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const CHARGE_TIMEOUT_MS = 65_000;

export class TossBillingApiError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly outcomeUnknown: boolean;

  constructor(input: {
    code: string;
    message: string;
    status?: number | null;
    retryable?: boolean;
    outcomeUnknown?: boolean;
  }) {
    super(input.message.slice(0, 300));
    this.name = "TossBillingApiError";
    this.code = input.code.slice(0, 100);
    this.status = input.status ?? null;
    this.retryable = input.retryable ?? false;
    this.outcomeUnknown = input.outcomeUnknown ?? false;
  }
}

export type TossBillingCardSummary = {
  issuerCode: string | null;
  acquirerCode: string | null;
  number: string | null;
  cardType: string | null;
  ownerType: string | null;
};

export type TossBillingKeyResponse = {
  mId: string;
  customerKey: string;
  authenticatedAt: string;
  method: string;
  billingKey: string;
  card: TossBillingCardSummary | null;
};

export type TossBillingPaymentResponse = {
  paymentKey: string;
  orderId: string;
  orderName: string;
  status: string;
  totalAmount: number;
  balanceAmount: number;
  approvedAt: string | null;
  requestedAt: string | null;
  method: string | null;
  lastTransactionKey: string | null;
  card: TossBillingCardSummary | null;
  receiptUrl?: string | null;
  cancels: Array<{
    transactionKey: string | null;
    cancelAmount: number;
    cancelReason: string | null;
    canceledAt: string | null;
    cancelStatus: string | null;
  }>;
};

function basicAuthorization(secretKey: string) {
  return `Basic ${Buffer.from(`${secretKey}:`, "utf8").toString("base64")}`;
}

function boundedString(value: unknown, max = 300) {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function boundedInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
}

function cardSummary(value: unknown): TossBillingCardSummary | null {
  if (!value || typeof value !== "object") return null;
  const card = value as Record<string, unknown>;
  return {
    issuerCode: boundedString(card.issuerCode, 30),
    acquirerCode: boundedString(card.acquirerCode, 30),
    number: boundedString(card.number, 30),
    cardType: boundedString(card.cardType, 30),
    ownerType: boundedString(card.ownerType, 30),
  };
}

async function responseJson(response: Response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) {
    throw new TossBillingApiError({
      code: "RESPONSE_TOO_LARGE",
      message: "결제사 응답 크기가 허용 범위를 초과했습니다.",
      status: response.status,
    });
  }
  const text = await response.text();
  if (!text) return null;
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new TossBillingApiError({
      code: "RESPONSE_TOO_LARGE",
      message: "결제사 응답 크기가 허용 범위를 초과했습니다.",
      status: response.status,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new TossBillingApiError({
      code: "INVALID_PROVIDER_RESPONSE",
      message: "결제사 응답을 확인할 수 없습니다.",
      status: response.status,
    });
  }
}

function apiErrorFromResponse(status: number, value: unknown) {
  const body = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const code = boundedString(body.code, 100) || `HTTP_${status}`;
  const message = boundedString(body.message, 300) || "결제 요청을 처리하지 못했습니다.";
  return new TossBillingApiError({
    code,
    message,
    status,
    retryable: status === 408 || status === 429 || status >= 500,
    outcomeUnknown: false,
  });
}

async function tossRequest(input: {
  path: string;
  method: "GET" | "POST" | "DELETE";
  body?: Record<string, unknown>;
  idempotencyKey?: string;
  timeoutMs?: number;
  mutationMayHaveCompleted?: boolean;
  requiresCharges?: boolean;
}) {
  if (input.requiresCharges) assertTossBillingChargesEnabled();
  else assertTossBillingEnabled();
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = delay(timeoutMs, undefined, { signal: controller.signal })
    .then(() => controller.abort())
    .catch(() => undefined);
  const headers = new Headers({
    Authorization: basicAuthorization(
      input.requiresCharges ? tossBillingSecretKey() : tossBillingApiSecretKey(),
    ),
    "Content-Type": "application/json",
  });
  if (input.idempotencyKey) headers.set("Idempotency-Key", input.idempotencyKey);
  try {
    const response = await fetch(new URL(input.path, tossBillingApiBaseUrl()), {
      method: input.method,
      headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    const value = await responseJson(response);
    if (!response.ok) throw apiErrorFromResponse(response.status, value);
    return value;
  } catch (error) {
    if (error instanceof TossBillingApiError) throw error;
    throw new TossBillingApiError({
      code: error instanceof DOMException && error.name === "AbortError"
        ? "PROVIDER_TIMEOUT"
        : "PROVIDER_NETWORK_ERROR",
      message: "결제사 응답을 확인하지 못했습니다.",
      retryable: true,
      outcomeUnknown: input.mutationMayHaveCompleted ?? false,
    });
  } finally {
    controller.abort();
    await timeout;
  }
}

function parsePayment(value: unknown): TossBillingPaymentResponse {
  if (!value || typeof value !== "object") {
    throw new TossBillingApiError({
      code: "INVALID_PROVIDER_RESPONSE",
      message: "결제 승인 결과를 확인할 수 없습니다.",
    });
  }
  const body = value as Record<string, unknown>;
  const receipt = body.receipt && typeof body.receipt === "object"
    ? body.receipt as Record<string, unknown>
    : null;
  const paymentKey = boundedString(body.paymentKey, 200);
  const orderId = boundedString(body.orderId, 100);
  if (!paymentKey || !orderId) {
    throw new TossBillingApiError({
      code: "INVALID_PROVIDER_RESPONSE",
      message: "결제 승인 식별자가 누락되었습니다.",
    });
  }
  const cancels = Array.isArray(body.cancels)
    ? body.cancels.slice(0, 100).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const cancel = item as Record<string, unknown>;
      return [{
        transactionKey: boundedString(cancel.transactionKey, 200),
        cancelAmount: boundedInteger(cancel.cancelAmount),
        cancelReason: boundedString(cancel.cancelReason, 300),
        canceledAt: boundedString(cancel.canceledAt, 50),
        cancelStatus: boundedString(cancel.cancelStatus, 50),
      }];
    })
    : [];
  return {
    paymentKey,
    orderId,
    orderName: boundedString(body.orderName, 100) || "이지컷 구독",
    status: boundedString(body.status, 50) || "UNKNOWN",
    totalAmount: boundedInteger(body.totalAmount),
    balanceAmount: boundedInteger(body.balanceAmount),
    approvedAt: boundedString(body.approvedAt, 50),
    requestedAt: boundedString(body.requestedAt, 50),
    method: boundedString(body.method, 50),
    lastTransactionKey: boundedString(body.lastTransactionKey, 200),
    card: cardSummary(body.card),
    receiptUrl: boundedString(receipt?.url, 2_000),
    cancels,
  };
}

export async function issueTossBillingKey(input: {
  authKey: string;
  customerKey: string;
}) {
  const value = await tossRequest({
    path: "/v1/billing/authorizations/issue",
    method: "POST",
    body: { authKey: input.authKey, customerKey: input.customerKey },
    mutationMayHaveCompleted: true,
    requiresCharges: true,
  });
  if (!value || typeof value !== "object") {
    throw new TossBillingApiError({
      code: "INVALID_PROVIDER_RESPONSE",
      message: "빌링키 발급 결과를 확인할 수 없습니다.",
    });
  }
  const body = value as Record<string, unknown>;
  const billingKey = boundedString(body.billingKey, 200);
  const customerKey = boundedString(body.customerKey, 300);
  if (!billingKey || !customerKey) {
    throw new TossBillingApiError({
      code: "INVALID_PROVIDER_RESPONSE",
      message: "빌링키 발급 식별자가 누락되었습니다.",
    });
  }
  return {
    mId: boundedString(body.mId, 30) || "",
    customerKey,
    authenticatedAt: boundedString(body.authenticatedAt, 50) || "",
    method: boundedString(body.method, 50) || "카드",
    billingKey,
    card: cardSummary(body.card),
  } satisfies TossBillingKeyResponse;
}

export async function chargeTossBilling(input: {
  billingKey: string;
  customerKey: string;
  amountKrw: number;
  orderId: string;
  orderName: string;
  idempotencyKey: string;
}) {
  if (!Number.isSafeInteger(input.amountKrw) || input.amountKrw < 100) {
    throw new Error("결제 금액이 올바르지 않습니다.");
  }
  return parsePayment(await tossRequest({
    path: `/v1/billing/${encodeURIComponent(input.billingKey)}`,
    method: "POST",
    body: {
      customerKey: input.customerKey,
      amount: input.amountKrw,
      orderId: input.orderId,
      orderName: input.orderName.slice(0, 100),
      taxFreeAmount: 0,
    },
    idempotencyKey: input.idempotencyKey,
    timeoutMs: CHARGE_TIMEOUT_MS,
    mutationMayHaveCompleted: true,
    requiresCharges: true,
  }));
}

export async function getTossPaymentByOrderId(orderId: string) {
  return parsePayment(await tossRequest({
    path: `/v1/payments/orders/${encodeURIComponent(orderId)}`,
    method: "GET",
  }));
}

export async function cancelTossPayment(input: {
  paymentKey: string;
  cancelReason: string;
  cancelAmountKrw?: number;
  idempotencyKey: string;
}) {
  const body: Record<string, unknown> = {
    cancelReason: input.cancelReason.slice(0, 200),
  };
  if (input.cancelAmountKrw !== undefined) {
    if (!Number.isSafeInteger(input.cancelAmountKrw) || input.cancelAmountKrw < 1) {
      throw new Error("취소 금액이 올바르지 않습니다.");
    }
    body.cancelAmount = input.cancelAmountKrw;
  }
  return parsePayment(await tossRequest({
    path: `/v1/payments/${encodeURIComponent(input.paymentKey)}/cancel`,
    method: "POST",
    body,
    idempotencyKey: input.idempotencyKey,
    mutationMayHaveCompleted: true,
  }));
}

export async function deleteTossBillingKey(billingKey: string) {
  await tossRequest({
    path: `/v1/billing/${encodeURIComponent(billingKey)}`,
    method: "DELETE",
    mutationMayHaveCompleted: true,
  });
}
