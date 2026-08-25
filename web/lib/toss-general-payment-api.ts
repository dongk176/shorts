import { setTimeout as delay } from "node:timers/promises";
import {
  tossGeneralPaymentApiBaseUrl,
  tossGeneralPaymentKeys,
} from "@/lib/toss-general-payment-config";

const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 65_000;

export class TossGeneralPaymentApiError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly outcomeUnknown: boolean;

  constructor(input: {
    code: string;
    message: string;
    status?: number | null;
    outcomeUnknown?: boolean;
  }) {
    super(input.message.slice(0, 300));
    this.name = "TossGeneralPaymentApiError";
    this.code = input.code.slice(0, 100);
    this.status = input.status ?? null;
    this.outcomeUnknown = input.outcomeUnknown ?? false;
  }
}

export type TossGeneralPayment = {
  paymentKey: string;
  orderId: string;
  orderName: string;
  type: string | null;
  status: string;
  method: string | null;
  totalAmount: number;
  approvedAt: string | null;
  receiptUrl: string | null;
};

function basicAuthorization(secretKey: string) {
  return `Basic ${Buffer.from(`${secretKey}:`, "utf8").toString("base64")}`;
}

function boundedString(value: unknown, max: number) {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, max)
    : null;
}

function safeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
}

async function responseJson(response: Response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) {
    throw new TossGeneralPaymentApiError({
      code: "RESPONSE_TOO_LARGE",
      message: "결제사 응답 크기가 허용 범위를 초과했습니다.",
      status: response.status,
    });
  }
  const text = await response.text();
  if (!text) return null;
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new TossGeneralPaymentApiError({
      code: "RESPONSE_TOO_LARGE",
      message: "결제사 응답 크기가 허용 범위를 초과했습니다.",
      status: response.status,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new TossGeneralPaymentApiError({
      code: "INVALID_PROVIDER_RESPONSE",
      message: "결제사 응답을 확인할 수 없습니다.",
      status: response.status,
    });
  }
}

function providerError(status: number, value: unknown) {
  const body = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return new TossGeneralPaymentApiError({
    code: boundedString(body.code, 100) || `HTTP_${status}`,
    message: boundedString(body.message, 300) || "결제 승인을 완료하지 못했습니다.",
    status,
  });
}

function parsePayment(value: unknown): TossGeneralPayment {
  if (!value || typeof value !== "object") {
    throw new TossGeneralPaymentApiError({
      code: "INVALID_PROVIDER_RESPONSE",
      message: "결제 승인 결과를 확인할 수 없습니다.",
    });
  }
  const body = value as Record<string, unknown>;
  const paymentKey = boundedString(body.paymentKey, 200);
  const orderId = boundedString(body.orderId, 64);
  if (!paymentKey || !orderId) {
    throw new TossGeneralPaymentApiError({
      code: "INVALID_PROVIDER_RESPONSE",
      message: "결제 승인 식별자가 누락되었습니다.",
    });
  }
  const receipt = body.receipt && typeof body.receipt === "object"
    ? body.receipt as Record<string, unknown>
    : null;
  return {
    paymentKey,
    orderId,
    orderName: boundedString(body.orderName, 100) || "이지컷 기업 결제",
    type: boundedString(body.type, 30),
    status: boundedString(body.status, 50) || "UNKNOWN",
    method: boundedString(body.method, 50),
    totalAmount: safeInteger(body.totalAmount),
    approvedAt: boundedString(body.approvedAt, 50),
    receiptUrl: boundedString(receipt?.url, 2000),
  };
}

async function tossRequest(input: {
  path: string;
  method: "GET" | "POST";
  body?: Record<string, unknown>;
  idempotencyKey?: string;
  mutationMayHaveCompleted?: boolean;
}) {
  const { secretKey } = tossGeneralPaymentKeys();
  const controller = new AbortController();
  const timeout = delay(REQUEST_TIMEOUT_MS, undefined, { signal: controller.signal })
    .then(() => controller.abort())
    .catch(() => undefined);
  const headers = new Headers({
    Authorization: basicAuthorization(secretKey),
    "Content-Type": "application/json",
  });
  if (input.idempotencyKey) headers.set("Idempotency-Key", input.idempotencyKey);
  try {
    const response = await fetch(new URL(input.path, tossGeneralPaymentApiBaseUrl()), {
      method: input.method,
      headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    const value = await responseJson(response);
    if (!response.ok) throw providerError(response.status, value);
    return value;
  } catch (error) {
    if (error instanceof TossGeneralPaymentApiError) throw error;
    throw new TossGeneralPaymentApiError({
      code: error instanceof DOMException && error.name === "AbortError"
        ? "PROVIDER_TIMEOUT"
        : "PROVIDER_NETWORK_ERROR",
      message: "결제사 응답을 확인하지 못했습니다.",
      outcomeUnknown: input.mutationMayHaveCompleted ?? false,
    });
  } finally {
    controller.abort();
    await timeout;
  }
}

export async function confirmTossGeneralPayment(input: {
  paymentKey: string;
  orderId: string;
  amount: number;
  idempotencyKey: string;
}) {
  return parsePayment(await tossRequest({
    path: "/v1/payments/confirm",
    method: "POST",
    body: {
      paymentKey: input.paymentKey,
      orderId: input.orderId,
      amount: input.amount,
    },
    idempotencyKey: input.idempotencyKey,
    mutationMayHaveCompleted: true,
  }));
}

export async function getTossGeneralPaymentByOrderId(orderId: string) {
  return parsePayment(await tossRequest({
    path: `/v1/payments/orders/${encodeURIComponent(orderId)}`,
    method: "GET",
  }));
}
