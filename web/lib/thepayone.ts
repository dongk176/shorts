import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";

const DEFAULT_API_BASE_URL = "https://api.thepayone.com";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export class PaymentConfigurationError extends Error {}

export class ThePayOneError extends Error {
  constructor(
    message: string,
    readonly resultCode = "UPSTREAM_ERROR",
    readonly diagnostic: string | null = null,
  ) {
    super(message);
  }
}

type ThePayOneConfig = {
  apiBaseUrl: string;
  merchantId: string;
  payKey: string;
  encryptionKey: Buffer;
};

export type CardRegistrationRequest = {
  trackId: string;
  payerName: string;
  payerEmail: string;
  payerTel: string;
  cardNumber: string;
  expiry: string;
  authDob: string;
  authPw: string;
};

export type CardRegistrationResult = {
  resultCode: string;
  providerTransactionId: string;
  cardId: string;
  last4: string;
  issuer: string | null;
  cardType: string | null;
  acquirer: string | null;
};

export type CardRevocationResult = {
  resultCode: string;
  providerTransactionId: string | null;
};

export type EncryptedCardToken = {
  ciphertext: string;
  iv: string;
  tag: string;
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new PaymentConfigurationError(`${name} 환경변수가 설정되지 않았습니다.`);
  return value;
}

function encryptionKey() {
  const raw = requiredEnv("THEPAYONE_CARD_TOKEN_ENCRYPTION_KEY");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) {
    throw new PaymentConfigurationError("THEPAYONE_CARD_TOKEN_ENCRYPTION_KEY는 32바이트 base64 값이어야 합니다.");
  }
  return decoded;
}

export function getThePayOneConfig(): ThePayOneConfig {
  const apiBaseUrl = process.env.THEPAYONE_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(apiBaseUrl);
  } catch {
    throw new PaymentConfigurationError("THEPAYONE_API_BASE_URL 형식이 올바르지 않습니다.");
  }
  if (parsed.protocol !== "https:") {
    throw new PaymentConfigurationError("더페이원 API는 HTTPS 주소만 사용할 수 있습니다.");
  }
  return {
    apiBaseUrl: parsed.origin,
    merchantId: requiredEnv("THEPAYONE_MID"),
    payKey: requiredEnv("THEPAYONE_PAY_KEY"),
    encryptionKey: encryptionKey(),
  };
}

export function createPaymentTrackId(prefix: "AUTH" | "AUDT") {
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `EC-${prefix}-${timestamp}-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

export function normalizeCardNumber(value: string) {
  return value.replace(/[^0-9]/g, "");
}

export function isSupportedCardNumber(value: string) {
  return /^\d{13,19}$/.test(normalizeCardNumber(value));
}

export function isValidLuhn(value: string) {
  const digits = normalizeCardNumber(value);
  if (digits.length < 13 || digits.length > 19) return false;
  let total = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    total += digit;
    doubleDigit = !doubleDigit;
  }
  return total % 10 === 0;
}

function stringValue(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function responseFieldShape(value: unknown, path = "root", depth = 0): string {
  if (depth > 2) return "";
  const object = objectValue(value);
  if (!object) return "";
  const safeKeys = Object.keys(object)
    .filter((key) => /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key))
    .slice(0, 20);
  const parts = safeKeys.length ? [`${path}=[${safeKeys.join(",")}]`] : [];
  for (const key of safeKeys) {
    const child = objectValue(object[key]);
    if (child) parts.push(responseFieldShape(child, `${path}.${key}`, depth + 1));
  }
  return parts.filter(Boolean).join(" ").slice(0, 700);
}

function sanitizedProviderDiagnostic(...values: unknown[]) {
  const messages = values
    .map((value) => stringValue(value, 128))
    .filter((value): value is string => Boolean(value))
    .map((value) => value
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[이메일 숨김]")
      .replace(/(?:\d[ -]?){12,19}/g, "[카드정보 숨김]")
      .replace(/\d{6,}/g, "[숫자정보 숨김]")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);
  return [...new Set(messages)].join(" / ").slice(0, 260) || null;
}

async function parseResponse(response: Response) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new ThePayOneError("더페이원 응답 크기가 허용 범위를 초과했습니다.");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new ThePayOneError("더페이원 응답 크기가 허용 범위를 초과했습니다.");
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ThePayOneError("더페이원에서 올바른 JSON 응답을 받지 못했습니다.");
  }
  if (!response.ok) {
    throw new ThePayOneError(`더페이원 요청에 실패했습니다. (HTTP ${response.status})`, `HTTP_${response.status}`);
  }
  const root = objectValue(body);
  const result = objectValue(root?.result);
  const resultCode = stringValue(result?.resultCd, 32);
  if (!root || !result || !resultCode) {
    throw new ThePayOneError("더페이원 응답 형식을 확인하지 못했습니다.");
  }
  if (resultCode !== "0000") {
    throw new ThePayOneError(
      `더페이원 처리에 실패했습니다. (코드: ${resultCode})`,
      resultCode,
      sanitizedProviderDiagnostic(result.resultMsg, result.advanceMsg),
    );
  }
  return { root, resultCode };
}

async function thePayOnePost(path: "/api/auth" | "/api/audt", payload: unknown) {
  const config = getThePayOneConfig();
  let response: Response;
  try {
    response = await fetch(new URL(path, config.apiBaseUrl), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: config.payKey,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof PaymentConfigurationError) throw error;
    throw new ThePayOneError("더페이원 서버에 연결하지 못했습니다.");
  }
  return parseResponse(response);
}

export async function registerThePayOneCard(input: CardRegistrationRequest): Promise<CardRegistrationResult> {
  const { root, resultCode } = await thePayOnePost("/api/auth", {
    auth: {
      // The live /api/auth service requires trnType, while recurring merchants
      // must identify the card flow with trxType=card.
      trnType: "ONTR",
      trxType: "card",
      trackId: input.trackId,
      amount: 0,
      payerName: input.payerName,
      payerEmail: input.payerEmail,
      payerTel: input.payerTel,
      udf1: input.trackId,
      udf2: "00",
      recurring: true,
      prodName: "Easy Cut 카드등록 테스트",
      prodQty: "1",
      prodAmt: "0",
      card: {
        number: input.cardNumber,
        expiry: input.expiry,
      },
      metadata: {
        authDob: input.authDob,
        authPw: input.authPw,
      },
    },
  });
  const auth = objectValue(root.auth);
  const card = objectValue(auth?.card);
  const cardId = stringValue(card?.cardId, 256);
  const transactionId = stringValue(auth?.trxId, 128);
  const providerLast4 = stringValue(card?.last4, 16);
  const last4 = providerLast4 && /^\d{4}$/.test(providerLast4)
    ? providerLast4
    : input.cardNumber.slice(-4);
  if (!auth || !card || !cardId || !transactionId) {
    const missing = [
      !auth && "auth",
      !card && "card",
      !cardId && "cardId",
      !transactionId && "trxId",
    ].filter(Boolean).join(",");
    throw new ThePayOneError(
      "더페이원 카드 등록 응답에 필수 정보가 없습니다.",
      "INVALID_SUCCESS_RESPONSE",
      `누락: ${missing} · ${responseFieldShape(root)}`,
    );
  }
  return {
    resultCode,
    providerTransactionId: transactionId,
    cardId,
    last4,
    issuer: stringValue(card.issuer, 100),
    cardType: stringValue(card.cardType, 50),
    acquirer: stringValue(card.acquirer, 100),
  };
}

export async function revokeThePayOneCard(cardId: string, trackId: string): Promise<CardRevocationResult> {
  const { root, resultCode } = await thePayOnePost("/api/audt", {
    audt: {
      cardId,
      status: "폐기",
      trackId,
    },
  });
  const audit = objectValue(root.audt);
  return {
    resultCode,
    providerTransactionId: stringValue(audit?.trxId, 128),
  };
}

export function encryptCardToken(cardId: string, context: string): EncryptedCardToken {
  const { encryptionKey: key } = getThePayOneConfig();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(cardId, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptCardToken(token: EncryptedCardToken, context: string) {
  const { encryptionKey: key } = getThePayOneConfig();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(token.iv, "base64"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(token.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(token.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  if (!plaintext || plaintext.length > 256) throw new Error("저장된 카드 토큰 형식이 올바르지 않습니다.");
  return plaintext;
}
