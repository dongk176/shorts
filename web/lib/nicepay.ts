import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const DEFAULT_API_BASE_URL = "https://api.nicepay.co.kr";
export const NICEPAY_SDK_URL = "https://pay.nicepay.co.kr/v1/js/";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 128 * 1024;

export class NicepayConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NicepayConfigurationError";
  }
}

export class NicepayApiError extends Error {
  constructor(
    message: string,
    readonly code = "NICEPAY_UPSTREAM_ERROR",
    readonly status = 502,
    readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = "NicepayApiError";
  }
}

export type EncryptedBillingKey = {
  ciphertext: string;
  iv: string;
  tag: string;
};

export type NicepayCardSummary = {
  issuerCode: string | null;
  issuerName: string | null;
  cardNumberMasked: string | null;
  cardLast4: string | null;
  cardType: string | null;
  acquirerCode: string | null;
  acquirerName: string | null;
};

export type NicepayBillingKey = NicepayCardSummary & {
  billingKey: string;
  orderId: string;
  transactionId: string;
  resultCode: string;
  resultMessage: string;
  authorizedAt: string | null;
};

export type NicepayPayment = NicepayCardSummary & {
  transactionId: string;
  orderId: string;
  amount: number;
  status: string;
  resultCode: string;
  resultMessage: string;
  paidAt: string | null;
  ediDate: string | null;
  signature: string | null;
  receiptUrl: string | null;
};

type BillingCardInput = {
  cardNumber: string;
  expiryYear: string;
  expiryMonth: string;
  identityNumber: string;
  cardPassword: string;
};

type RegisterBillingKeyInput = BillingCardInput & {
  orderId: string;
  buyerName?: string | null;
  buyerEmail?: string | null;
  buyerTel?: string | null;
};

type ChargeBillingKeyInput = {
  billingKey: string;
  orderId: string;
  amount: number;
  goodsName: string;
  buyerName?: string | null;
  buyerEmail?: string | null;
  buyerTel?: string | null;
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new NicepayConfigurationError(`${name} 환경변수가 설정되지 않았습니다.`);
  return value;
}

function apiBaseUrl() {
  const raw = process.env.NICEPAY_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NicepayConfigurationError("NICEPAY_API_BASE_URL 형식이 올바르지 않습니다.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new NicepayConfigurationError("나이스페이 API는 인증정보가 없는 HTTPS 주소만 사용할 수 있습니다.");
  }
  return url.origin;
}

function atRestEncryptionKey() {
  const raw = requiredEnv("NICEPAY_BILLING_KEY_ENCRYPTION_KEY");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32 || decoded.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) {
    throw new NicepayConfigurationError("NICEPAY_BILLING_KEY_ENCRYPTION_KEY는 32바이트 base64 값이어야 합니다.");
  }
  return decoded;
}

function nicepaySecretKey() {
  return requiredEnv("NICEPAY_SECRET_KEY");
}

export function nicepayClientKey() {
  return requiredEnv("NICEPAY_CLIENT_KEY");
}

function basicAuthorization() {
  return `Basic ${Buffer.from(`${nicepayClientKey()}:${nicepaySecretKey()}`, "utf8").toString("base64")}`;
}

function safeText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function normalizedRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) output[key.toLowerCase()] = item;
  return output;
}

function field(record: Record<string, unknown>, name: string) {
  return record[name.toLowerCase()];
}

function stringField(record: Record<string, unknown>, name: string, maxLength: number) {
  return safeText(field(record, name), maxLength);
}

function numberField(record: Record<string, unknown>, name: string) {
  const value = field(record, name);
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function nicepayErrorFromBody(body: Record<string, unknown>, httpStatus = 502) {
  const code = stringField(body, "resultCode", 80) || `HTTP_${httpStatus}`;
  const message = stringField(body, "resultMsg", 300) || "나이스페이 결제 요청이 승인되지 않았습니다.";
  return new NicepayApiError(message, code, httpStatus, httpStatus >= 500);
}

async function nicepayRequest(path: string, body: Record<string, unknown>) {
  let response: Response;
  try {
    response = await fetch(new URL(path, apiBaseUrl()), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: basicAuthorization(),
        "Content-Type": "application/json;charset=utf-8",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof NicepayConfigurationError) throw error;
    throw new NicepayApiError(
      "나이스페이 서버의 응답을 확인하지 못했습니다. 관리자에서 거래 여부를 확인해 주세요.",
      "NETWORK_ERROR",
      503,
      true,
    );
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new NicepayApiError("나이스페이 응답 크기가 허용 범위를 초과했습니다.", "INVALID_RESPONSE");
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw new NicepayApiError("나이스페이 응답 크기가 허용 범위를 초과했습니다.", "INVALID_RESPONSE");
  }
  let decoded: unknown;
  try {
    decoded = text ? JSON.parse(text) : {};
  } catch {
    throw new NicepayApiError(
      "나이스페이에서 올바른 JSON 응답을 받지 못했습니다.",
      "INVALID_RESPONSE",
      502,
      response.status >= 500,
    );
  }
  const result = normalizedRecord(decoded);
  if (!response.ok) throw nicepayErrorFromBody(result, response.status);
  return result;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function constantTimeHexEqual(left: string, right: string) {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  const a = Buffer.from(left.toLowerCase(), "hex");
  const b = Buffer.from(right.toLowerCase(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function safeSecretEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createNicepayOrderId(prefix: string) {
  const safePrefix = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "PAY";
  return `${safePrefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(8).toString("hex").toUpperCase()}`.slice(0, 64);
}

export function encryptBillingKey(value: string, context: string): EncryptedBillingKey {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", atRestEncryptionKey(), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptBillingKey(value: EncryptedBillingKey, context: string) {
  const decipher = createDecipheriv("aes-256-gcm", atRestEncryptionKey(), Buffer.from(value.iv, "base64"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function billingKeyHash(value: string) {
  return sha256(value);
}

export function nicepayAuthSignature(authToken: string, clientId: string, amount: number) {
  return sha256(`${authToken}${clientId}${amount}${nicepaySecretKey()}`);
}

export function verifyNicepayAuthSignature(input: {
  authToken: string;
  clientId: string;
  amount: number;
  signature: string;
}) {
  return constantTimeHexEqual(
    nicepayAuthSignature(input.authToken, input.clientId, input.amount),
    input.signature,
  );
}

function requestSignature(...values: Array<string | number>) {
  return sha256(`${values.join("")}${nicepaySecretKey()}`);
}

export function verifyNicepayPaymentSignature(payment: Pick<NicepayPayment, "transactionId" | "amount" | "ediDate" | "signature">) {
  if (!payment.ediDate || !payment.signature) return false;
  return constantTimeHexEqual(
    requestSignature(payment.transactionId, payment.amount, payment.ediDate),
    payment.signature,
  );
}

function encryptedCardData(input: BillingCardInput) {
  const secret = Buffer.from(nicepaySecretKey(), "utf8");
  if (secret.length !== 32) {
    throw new NicepayConfigurationError("NICEPAY_SECRET_KEY는 빌링 A2 암호화에 필요한 32바이트 값이어야 합니다.");
  }
  const plaintext = [
    `cardNo=${input.cardNumber}`,
    `expYear=${input.expiryYear}`,
    `expMonth=${input.expiryMonth}`,
    `idNo=${input.identityNumber}`,
    `cardPw=${input.cardPassword}`,
  ].join("&");
  const cipher = createCipheriv("aes-256-cbc", secret, secret.subarray(0, 16));
  return Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("hex");
}

function cardSummary(record: Record<string, unknown>, fallback: Record<string, unknown> = {}): NicepayCardSummary {
  const nested = normalizedRecord(field(record, "card"));
  const card = Object.keys(nested).length ? nested : fallback;
  const masked = stringField(card, "cardNum", 32) || stringField(card, "cardNo", 32) || "";
  const last4 = /([0-9]{4})$/.exec(masked.replace(/[^0-9*]/g, ""))?.[1] || null;
  return {
    issuerCode: stringField(card, "cardCode", 20) || null,
    issuerName: stringField(card, "cardName", 100).replace(/^\[|\]$/g, "") || null,
    cardNumberMasked: masked || null,
    cardLast4: last4,
    cardType: stringField(card, "cardType", 30) || null,
    acquirerCode: stringField(card, "acquCardCode", 20) || null,
    acquirerName: stringField(card, "acquCardName", 100) || null,
  };
}

function paymentFromResponse(result: Record<string, unknown>): NicepayPayment {
  const resultCode = stringField(result, "resultCode", 80);
  if (resultCode !== "0000") throw nicepayErrorFromBody(result);
  const transactionId = stringField(result, "tid", 80);
  const orderId = stringField(result, "orderId", 64);
  const amount = numberField(result, "amount");
  const status = stringField(result, "status", 30);
  if (!transactionId || !orderId || !Number.isSafeInteger(amount) || amount < 0 || !status) {
    throw new NicepayApiError("나이스페이 결제 응답 형식을 확인하지 못했습니다.", "INVALID_RESPONSE", 502, true);
  }
  return {
    transactionId,
    orderId,
    amount,
    status,
    resultCode,
    resultMessage: stringField(result, "resultMsg", 300),
    paidAt: stringField(result, "paidAt", 80) || null,
    ediDate: stringField(result, "ediDate", 80) || null,
    signature: stringField(result, "signature", 256) || null,
    receiptUrl: stringField(result, "receiptUrl", 500) || null,
    ...cardSummary(result),
  };
}

export async function registerNicepayBillingKey(input: RegisterBillingKeyInput): Promise<NicepayBillingKey> {
  const ediDate = new Date().toISOString();
  const result = await nicepayRequest("/v1/subscribe/regist", {
    encData: encryptedCardData(input),
    encMode: "A2",
    orderId: input.orderId,
    buyerName: input.buyerName || undefined,
    buyerEmail: input.buyerEmail || undefined,
    buyerTel: input.buyerTel || undefined,
    ediDate,
    signData: requestSignature(input.orderId, ediDate),
    returnCharSet: "utf-8",
  });
  const resultCode = stringField(result, "resultCode", 80);
  if (resultCode !== "0000") throw nicepayErrorFromBody(result);
  const billingKey = stringField(result, "bid", 100);
  const transactionId = stringField(result, "tid", 80);
  const responseOrderId = stringField(result, "orderId", 64);
  if (!billingKey || !transactionId || (responseOrderId && responseOrderId !== input.orderId)) {
    throw new NicepayApiError("나이스페이 빌링키 응답 형식을 확인하지 못했습니다.", "INVALID_RESPONSE", 502, true);
  }
  return {
    billingKey,
    orderId: responseOrderId || input.orderId,
    transactionId,
    resultCode,
    resultMessage: stringField(result, "resultMsg", 300),
    authorizedAt: stringField(result, "authDate", 80) || null,
    ...cardSummary(result, result),
  };
}

export async function chargeNicepayBillingKey(input: ChargeBillingKeyInput) {
  const ediDate = new Date().toISOString();
  const result = await nicepayRequest(`/v1/subscribe/${encodeURIComponent(input.billingKey)}/payments`, {
    orderId: input.orderId,
    amount: input.amount,
    goodsName: input.goodsName.slice(0, 40),
    cardQuota: "0",
    useShopInterest: false,
    buyerName: input.buyerName || undefined,
    buyerEmail: input.buyerEmail || undefined,
    buyerTel: input.buyerTel || undefined,
    ediDate,
    signData: requestSignature(input.orderId, input.billingKey, ediDate),
    returnCharSet: "utf-8",
  });
  return paymentFromResponse(result);
}

export async function expireNicepayBillingKey(billingKey: string, orderId: string) {
  const ediDate = new Date().toISOString();
  const result = await nicepayRequest(`/v1/subscribe/${encodeURIComponent(billingKey)}/expire`, {
    orderId,
    ediDate,
    signData: requestSignature(orderId, billingKey, ediDate),
    returnCharSet: "utf-8",
  });
  const resultCode = stringField(result, "resultCode", 80);
  if (resultCode !== "0000") throw nicepayErrorFromBody(result);
  const responseBid = stringField(result, "bid", 100);
  const responseOrderId = stringField(result, "orderId", 64);
  if ((responseBid && responseBid !== billingKey) || (responseOrderId && responseOrderId !== orderId)) {
    throw new NicepayApiError("나이스페이 빌링키 삭제 응답이 요청과 일치하지 않습니다.", "INVALID_RESPONSE", 502, true);
  }
  return {
    transactionId: stringField(result, "tid", 80) || null,
    resultCode,
    resultMessage: stringField(result, "resultMsg", 300),
  };
}

export async function confirmNicepayPayment(transactionId: string, amount: number) {
  const ediDate = new Date().toISOString();
  const result = await nicepayRequest(`/v1/payments/${encodeURIComponent(transactionId)}`, {
    amount,
    ediDate,
    signData: requestSignature(transactionId, amount, ediDate),
    returnCharSet: "utf-8",
  });
  return paymentFromResponse(result);
}
