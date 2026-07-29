import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";

const DEFAULT_API_BASE_URL = "https://api.thepayone.com";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export const THEPAYONE_SDK_URL = "https://api.thepayone.com/js/clientside.js";
export const THEPAYONE_WEBHOOK_SOURCE_IP = "203.245.13.111";

export class PaymentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentConfigurationError";
  }
}

export class ThePayOneError extends Error {
  constructor(
    message: string,
    readonly resultCode = "UPSTREAM_ERROR",
    readonly diagnostic: string | null = null,
    readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = "ThePayOneError";
  }
}

type ThePayOneConfig = {
  apiBaseUrl: string;
  payKey: string;
  encryptionKey: Buffer;
};

export type ThePayOneCredentialScope = "default" | "package";

export type CardRegistrationRequest = {
  trackId: string;
  payerName: string;
  payerEmail: string;
  payerTel: string;
  cardNumber: string;
  expiry: string;
  authDob: string;
  authPw: string;
  billingDay?: string;
  productName?: string;
};

export type CardRegistrationResult = {
  resultCode: string;
  providerTransactionId: string;
  cardId: string;
  last4: string;
  issuer: string | null;
  cardType: string | null;
  acquirer: string | null;
  trackId: string;
  amount: number;
  billingDay: string;
};

export type CardRevocationResult = {
  resultCode: string;
  providerTransactionId: string | null;
};

export type ThePayOneScheduleStatus = "사용" | "중지" | "폐기";

export type ThePayOneCardChargeRequest = {
  trackId: string;
  cardId: string;
  authDob: string;
  authPw: string;
  amount: number;
  payerName: string;
  payerEmail: string;
  payerTel: string;
  billingDay: string;
  installmentMonths?: number;
  productName: string;
  description?: string;
  referenceId?: string;
};

export type ThePayOneCardChargeResult = {
  resultCode: string;
  providerTransactionId: string;
  trackId: string;
  amount: number;
  terminalId: string;
  authCode: string | null;
  installmentMonths: number;
  cardId: string;
  last4: string | null;
  issuer: string | null;
  cardType: string | null;
  acquirer: string | null;
  approvedAt: Date;
};

export type ThePayOneRefundRequest = {
  trackId: string;
  rootTransactionId: string;
  amount: number;
  referenceId?: string;
  reason?: string;
};

export type ThePayOneRefundResult = {
  resultCode: string;
  providerTransactionId: string;
  rootTransactionId: string;
  rootTrackId: string | null;
  trackId: string;
  amount: number;
  taxAmount?: number | null;
  vatAmount?: number | null;
  taxFreeAmount?: number | null;
  serviceAmount?: number | null;
  terminalId: string;
  refundedAt: Date;
};

export function thePayOneTaxBreakdown(amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new ThePayOneError("과세 금액이 올바르지 않습니다.", "INVALID_REQUEST");
  }
  const taxAmount = Math.round(amount / 1.1);
  return {
    taxAmount,
    vatAmount: amount - taxAmount,
    taxFreeAmount: 0,
    serviceAmount: 0,
  };
}

export function thePayOneRefundMismatchFields(
  result: ThePayOneRefundResult,
  expected: {
    trackId: string;
    rootTransactionId: string;
    amount: number;
    terminalId: string;
  },
) {
  const expectedTax = thePayOneTaxBreakdown(expected.amount);
  return [
    result.trackId !== expected.trackId ? "trackId" : null,
    result.rootTransactionId !== expected.rootTransactionId ? "rootTransactionId" : null,
    result.amount !== expected.amount ? "amount" : null,
    result.taxAmount != null && result.taxAmount !== expectedTax.taxAmount ? "taxAmount" : null,
    result.vatAmount != null && result.vatAmount !== expectedTax.vatAmount ? "vatAmount" : null,
    result.taxFreeAmount != null && result.taxFreeAmount !== expectedTax.taxFreeAmount ? "taxFreeAmount" : null,
    result.serviceAmount != null && result.serviceAmount !== expectedTax.serviceAmount ? "serviceAmount" : null,
    result.terminalId !== expected.terminalId ? "terminalId" : null,
  ].filter((field): field is string => Boolean(field));
}

export type ThePayOneWebhookNotification = {
  merchantId: string;
  terminalId: string;
  transactionId: string;
  trackId: string;
  transactionType: "pay" | "refund";
  amount: number;
  cardId: string;
  last4: string | null;
  issuer: string | null;
  acquirer: string | null;
  cardType: string | null;
  authCode: string | null;
  capType: string | null;
  transactionDay: string | null;
  registeredDay: string | null;
  registeredTime: string | null;
  rootTransactionId: string | null;
  installmentMonths: number;
};

export type RecurringCardChargeRequest = {
  trackId: string;
  cardId: string;
  authDob: string;
  authPw: string;
  amount: number;
  payerName: string;
  payerEmail: string;
  payerTel: string;
  referenceId: string;
  sequenceNo: number;
  targetChargeCount: number;
  intervalSeconds: number;
};

export type RecurringCardChargeResult = {
  resultCode: string;
  providerTransactionId: string;
  trackId: string;
  amount: number;
  last4: string | null;
  issuer: string | null;
  cardType: string | null;
  acquirer: string | null;
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

export function assertThePayOneBillingEnabled() {
  if (process.env.THEPAYONE_BILLING_ENABLED?.trim().toLowerCase() !== "true") {
    throw new PaymentConfigurationError("더페이원 운영 결제가 아직 활성화되지 않았습니다.");
  }
}

export function thePayOnePackageBillingEnabled() {
  return process.env.THEPAYONE_PACKAGE_BILLING_ENABLED?.trim().toLowerCase() === "true";
}

export function thePayOneCredentialScopeForPackage(isPackage: boolean) {
  return isPackage && thePayOnePackageBillingEnabled()
    ? "package" as const
    : "default" as const;
}

function credentialEnvName(
  scope: ThePayOneCredentialScope,
  suffix: "MID" | "TERMINAL_ID" | "PAY_KEY",
) {
  return scope === "package"
    ? `THEPAYONE_PACKAGE_${suffix}`
    : `THEPAYONE_${suffix}`;
}

export function thePayOneMerchantId(scope: ThePayOneCredentialScope = "default") {
  if (scope === "package") {
    return process.env.THEPAYONE_PACKAGE_MID?.trim() || requiredEnv("THEPAYONE_MID");
  }
  return requiredEnv(credentialEnvName(scope, "MID"));
}

export function thePayOneTerminalId(scope: ThePayOneCredentialScope = "default") {
  return requiredEnv(credentialEnvName(scope, "TERMINAL_ID"));
}

export function thePayOnePublicKey(scope: ThePayOneCredentialScope = "default") {
  return requiredEnv(credentialEnvName(scope, "PAY_KEY"));
}

export function thePayOneCredentialScopeForMerchantTerminal(
  merchantId: string,
  terminalId: string,
): ThePayOneCredentialScope {
  const defaultMatches = merchantId === thePayOneMerchantId()
    && terminalId === thePayOneTerminalId();
  if (defaultMatches) return "default";
  const packageMatches = merchantId === thePayOneMerchantId("package")
    && terminalId === thePayOneTerminalId("package");
  if (packageMatches) return "package";
  throw new PaymentConfigurationError("등록되지 않은 더페이원 가맹점 또는 터미널입니다.");
}

export function isKnownThePayOneMerchantTerminal(
  merchantId: string,
  terminalId: string,
) {
  try {
    thePayOneCredentialScopeForMerchantTerminal(merchantId, terminalId);
    return true;
  } catch {
    return false;
  }
}

export function thePayOneWebhookSecret() {
  const value = requiredEnv("THEPAYONE_WEBHOOK_SECRET");
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(value)) {
    throw new PaymentConfigurationError("THEPAYONE_WEBHOOK_SECRET 형식이 올바르지 않습니다.");
  }
  return value;
}

export function thePayOneWebhookBaseUrl() {
  const value = requiredEnv("THEPAYONE_WEBHOOK_BASE_URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PaymentConfigurationError("THEPAYONE_WEBHOOK_BASE_URL 형식이 올바르지 않습니다.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new PaymentConfigurationError("더페이원 결과 통지 주소는 인증정보가 없는 HTTPS 주소여야 합니다.");
  }
  return url.origin;
}

function encryptionKey() {
  const raw = requiredEnv("THEPAYONE_CARD_TOKEN_ENCRYPTION_KEY");
  const decoded = Buffer.from(raw, "base64");
  if (
    decoded.length !== 32
    || decoded.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")
  ) {
    throw new PaymentConfigurationError("THEPAYONE_CARD_TOKEN_ENCRYPTION_KEY는 32바이트 base64 값이어야 합니다.");
  }
  return decoded;
}

export function getThePayOneConfig(
  scope: ThePayOneCredentialScope = "default",
): ThePayOneConfig {
  const apiBaseUrl = process.env.THEPAYONE_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(apiBaseUrl);
  } catch {
    throw new PaymentConfigurationError("THEPAYONE_API_BASE_URL 형식이 올바르지 않습니다.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new PaymentConfigurationError("더페이원 API는 인증정보가 없는 HTTPS 주소만 사용할 수 있습니다.");
  }
  return {
    apiBaseUrl: parsed.origin,
    payKey: thePayOnePublicKey(scope),
    encryptionKey: encryptionKey(),
  };
}

export function createPaymentTrackId(prefix: "AUTH" | "AUDT" | "PAY" | "REFUND") {
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `EC-${prefix}-${timestamp}-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

export function normalizeCardNumber(value: string) {
  return value.replace(/[^0-9]/g, "");
}

export function isSupportedCardNumber(value: string) {
  return /^\d{13,19}$/.test(normalizeCardNumber(value));
}

function stringValue(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function validBillingDay(value: string) {
  return /^(00|0[1-9]|1[0-9]|2[0-8])$/.test(value);
}

function safeProductName(value: string) {
  const normalized = value.trim();
  if (!normalized) throw new ThePayOneError("상품명이 비어 있습니다.", "INVALID_REQUEST");
  return [...normalized].slice(0, 20).join("");
}

function providerCreatedAt(value: unknown) {
  const raw = stringValue(value, 14);
  if (!raw || !/^\d{14}$/.test(raw)) return new Date();
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  const hour = Number(raw.slice(8, 10));
  const minute = Number(raw.slice(10, 12));
  const second = Number(raw.slice(12, 14));
  const date = new Date(Date.UTC(year, month - 1, day, hour - 9, minute, second));
  return Number.isNaN(date.getTime()) ? new Date() : date;
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
      .replace(/(?:\d[ -]?){10,11}/g, "[연락처 숨김]")
      .replace(/\d{6,}/g, "[숫자정보 숨김]")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);
  return [...new Set(messages)].join(" / ").slice(0, 260) || null;
}

async function parseResponse(response: Response) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new ThePayOneError("더페이원 응답 크기가 허용 범위를 초과했습니다.", "INVALID_RESPONSE", null, true);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new ThePayOneError("더페이원 응답 크기가 허용 범위를 초과했습니다.", "INVALID_RESPONSE", null, true);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ThePayOneError("더페이원에서 올바른 JSON 응답을 받지 못했습니다.", "INVALID_RESPONSE", null, true);
  }
  const root = objectValue(body);
  const result = objectValue(root?.result);
  const resultCode = stringValue(result?.resultCd, 32);
  if (!response.ok) {
    throw new ThePayOneError(
      `더페이원 요청에 실패했습니다. (HTTP ${response.status})`,
      resultCode || `HTTP_${response.status}`,
      sanitizedProviderDiagnostic(result?.resultMsg, result?.advanceMsg),
      response.status >= 500,
    );
  }
  if (!root || !result || !resultCode) {
    throw new ThePayOneError("더페이원 응답 형식을 확인하지 못했습니다.", "INVALID_RESPONSE", null, true);
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

async function thePayOnePost(
  path: "/api/auth" | "/api/audt" | "/api/pay" | "/api/refund",
  payload: unknown,
  scope: ThePayOneCredentialScope,
) {
  const config = getThePayOneConfig(scope);
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
    if (error instanceof PaymentConfigurationError || error instanceof ThePayOneError) throw error;
    throw new ThePayOneError("더페이원 서버에 연결하지 못했습니다.", "NETWORK_ERROR", null, true);
  }
  return parseResponse(response);
}

export async function registerThePayOneCard(
  input: CardRegistrationRequest,
  scope: ThePayOneCredentialScope = "default",
): Promise<CardRegistrationResult> {
  const amount = 0;
  const billingDay = input.billingDay ?? "00";
  if (!validBillingDay(billingDay)) {
    throw new ThePayOneError("카드 등록 결제일이 올바르지 않습니다.", "INVALID_REQUEST");
  }
  const productName = safeProductName(input.productName || "Easy Cut 카드등록");
  const { root, resultCode } = await thePayOnePost("/api/auth", {
    auth: {
      // Verified against the live card-only registration flow on 2026-07-16.
      // The live endpoint requires trnType=ONTR and identifies card auth via trxType=card.
      trnType: "ONTR",
      trxType: "card",
      trackId: input.trackId,
      amount,
      payerName: input.payerName,
      payerEmail: input.payerEmail,
      payerTel: input.payerTel,
      udf1: input.trackId,
      udf2: billingDay,
      recurring: true,
      prodName: productName,
      prodQty: "1",
      prodAmt: String(amount),
      card: {
        number: input.cardNumber,
        expiry: input.expiry,
      },
      metadata: {
        cardAuth: "true",
        authDob: input.authDob,
        authPw: input.authPw,
      },
    },
  }, scope);
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
      true,
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
    trackId: stringValue(auth.trackId, 128) || input.trackId,
    amount: Number.isSafeInteger(numberValue(auth.amount)) ? numberValue(auth.amount) : amount,
    billingDay: stringValue(auth.udf2, 2) || billingDay,
  };
}

export async function changeThePayOneCardStatus(
  cardId: string,
  status: ThePayOneScheduleStatus,
  trackId: string,
  scope: ThePayOneCredentialScope = "default",
): Promise<CardRevocationResult> {
  const { root, resultCode } = await thePayOnePost("/api/audt", {
    audt: {
      cardId,
      status,
      trackId,
    },
  }, scope);
  const audit = objectValue(root.audt);
  return {
    resultCode,
    providerTransactionId: stringValue(audit?.trxId, 128),
  };
}

export function revokeThePayOneCard(
  cardId: string,
  trackId: string,
  scope: ThePayOneCredentialScope = "default",
) {
  return changeThePayOneCardStatus(cardId, "폐기", trackId, scope);
}

function validateChargeRequest(amount: number, installmentMonths: number) {
  if (
    !Number.isSafeInteger(amount)
    || amount <= 0
    || !Number.isSafeInteger(installmentMonths)
    || installmentMonths < 0
    || installmentMonths > 36
    || installmentMonths === 1
  ) {
    throw new ThePayOneError("결제 금액 또는 할부 개월이 올바르지 않습니다.", "INVALID_REQUEST");
  }
}

function parseCardChargeResult(
  root: Record<string, unknown>,
  resultCode: string,
  fallbackInstallmentMonths: number,
): ThePayOneCardChargeResult {
  const result = objectValue(root.result);
  const pay = objectValue(root.pay);
  const card = objectValue(pay?.card);
  const transactionId = stringValue(pay?.trxId, 128);
  const responseTrackId = stringValue(pay?.trackId, 128);
  const responseAmount = numberValue(pay?.amount);
  const terminalId = stringValue(pay?.tmnId, 64);
  const responseCardId = stringValue(card?.cardId, 256);
  const responseInstallment = numberValue(card?.installment ?? card?.Installment);
  if (
    !pay || !transactionId || !responseTrackId || !Number.isSafeInteger(responseAmount)
    || !terminalId || !responseCardId
    || (fallbackInstallmentMonths > 0 && !Number.isSafeInteger(responseInstallment))
  ) {
    throw new ThePayOneError(
      "더페이원 결제 성공 응답의 필수 정보를 확인하지 못했습니다.",
      "INVALID_SUCCESS_RESPONSE",
      responseFieldShape(root),
      true,
    );
  }
  const providerLast4 = stringValue(card?.last4, 16);
  return {
    resultCode,
    providerTransactionId: transactionId,
    trackId: responseTrackId,
    amount: responseAmount,
    terminalId,
    authCode: stringValue(pay.authCd, 32),
    installmentMonths: Number.isSafeInteger(responseInstallment)
      ? Number(responseInstallment)
      : fallbackInstallmentMonths,
    cardId: responseCardId,
    last4: providerLast4 && /^\d{4}$/.test(providerLast4) ? providerLast4 : null,
    issuer: stringValue(card?.issuer, 100),
    cardType: stringValue(card?.cardType, 50),
    acquirer: stringValue(card?.acquirer, 100),
    approvedAt: providerCreatedAt(result?.create),
  };
}

export async function chargeThePayOneCard(
  input: ThePayOneCardChargeRequest,
  scope: ThePayOneCredentialScope = "default",
): Promise<ThePayOneCardChargeResult> {
  const installmentMonths = input.installmentMonths ?? 0;
  validateChargeRequest(input.amount, installmentMonths);
  if (!validBillingDay(input.billingDay)) {
    throw new ThePayOneError("결제 금액 또는 결제일이 올바르지 않습니다.", "INVALID_REQUEST");
  }
  const productName = safeProductName(input.productName);
  const { root, resultCode } = await thePayOnePost("/api/pay", {
    pay: {
      trxType: "ONTR",
      trackId: input.trackId,
      amount: input.amount,
      payerName: input.payerName,
      payerEmail: input.payerEmail,
      payerTel: input.payerTel,
      udf1: input.referenceId || input.trackId,
      udf2: input.billingDay,
      card: {
        Installment: String(installmentMonths).padStart(2, "0"),
        cardId: input.cardId,
      },
      products: [{
        name: productName,
        qty: "1",
        price: String(input.amount),
        desc: [...(input.description || "Easy Cut 결제")].slice(0, 50).join(""),
      }],
      metadata: {
        recurring: "pay",
        cardAuth: "true",
        authDob: input.authDob,
        authPw: input.authPw,
      },
    },
  }, scope);
  return parseCardChargeResult(root, resultCode, installmentMonths);
}

export async function refundThePayOnePayment(
  input: ThePayOneRefundRequest,
  scope: ThePayOneCredentialScope = "default",
): Promise<ThePayOneRefundResult> {
  if (
    !input.trackId
    || !input.rootTransactionId
    || !Number.isSafeInteger(input.amount)
    || input.amount <= 0
  ) {
    throw new ThePayOneError("환불 거래 또는 금액이 올바르지 않습니다.", "INVALID_REQUEST");
  }
  const tax = thePayOneTaxBreakdown(input.amount);
  const reason = [...(input.reason || "Easy Cut 관리자 환불")].slice(0, 50).join("");
  const { root, resultCode } = await thePayOnePost("/api/refund", {
    refund: {
      trackId: input.trackId,
      amount: input.amount,
      rootTrxId: input.rootTransactionId,
      taxAmt: tax.taxAmount,
      vatAmt: tax.vatAmount,
      taxFreeAmt: tax.taxFreeAmount,
      serviceAmt: tax.serviceAmount,
      udf1: input.referenceId || input.trackId,
      metadata: { reason },
    },
  }, scope);
  const result = objectValue(root.result);
  const refund = objectValue(root.refund);
  const providerTransactionId = stringValue(refund?.trxId, 128);
  const rootTransactionId = stringValue(refund?.rootTrxId, 128) || input.rootTransactionId;
  const rootTrackId = stringValue(refund?.rootTrackId, 128);
  const trackId = stringValue(refund?.trackId, 128);
  const amount = numberValue(refund?.amount);
  const taxAmount = numberValue(refund?.taxAmt);
  const vatAmount = numberValue(refund?.vatAmt);
  const taxFreeAmount = numberValue(refund?.taxFreeAmt);
  const serviceAmount = numberValue(refund?.serviceAmt);
  const terminalId = stringValue(refund?.tmnId, 64);
  if (
    !refund
    || !providerTransactionId
    || !trackId
    || !Number.isSafeInteger(amount)
    || !terminalId
  ) {
    throw new ThePayOneError(
      "더페이원 환불 성공 응답의 필수 정보를 확인하지 못했습니다.",
      "INVALID_SUCCESS_RESPONSE",
      responseFieldShape(root),
      true,
    );
  }
  return {
    resultCode,
    providerTransactionId,
    rootTransactionId,
    rootTrackId,
    trackId,
    amount,
    taxAmount: Number.isSafeInteger(taxAmount) ? taxAmount : null,
    vatAmount: Number.isSafeInteger(vatAmount) ? vatAmount : null,
    taxFreeAmount: Number.isSafeInteger(taxFreeAmount) ? taxFreeAmount : null,
    serviceAmount: Number.isSafeInteger(serviceAmount) ? serviceAmount : null,
    terminalId,
    refundedAt: providerCreatedAt(result?.create),
  };
}

export async function chargeThePayOneRecurringCard(
  input: RecurringCardChargeRequest,
): Promise<RecurringCardChargeResult> {
  const payment = await chargeThePayOneCard({
    trackId: input.trackId,
    cardId: input.cardId,
    authDob: input.authDob,
    authPw: input.authPw,
    amount: input.amount,
    payerName: input.payerName,
    payerEmail: input.payerEmail,
    payerTel: input.payerTel,
    billingDay: "00",
    productName: `Easy Cut 정기결제 ${input.sequenceNo}회`,
    description: `${Math.round(input.intervalSeconds / 60)}분 간격 ${input.targetChargeCount}회 테스트`,
    referenceId: input.referenceId,
  });
  return {
    resultCode: payment.resultCode,
    providerTransactionId: payment.providerTransactionId,
    trackId: payment.trackId,
    amount: payment.amount,
    last4: payment.last4,
    issuer: payment.issuer,
    cardType: payment.cardType,
    acquirer: payment.acquirer,
  };
}

function webhookString(params: URLSearchParams, key: string, maxLength: number, required = false) {
  const value = params.get(key)?.trim() || "";
  if ((required && !value) || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ThePayOneError("더페이원 결과 통지 형식이 올바르지 않습니다.", "INVALID_WEBHOOK");
  }
  return value || null;
}

export function parseThePayOneWebhook(rawBody: string): ThePayOneWebhookNotification {
  if (Buffer.byteLength(rawBody, "utf8") > 32 * 1024 || !rawBody.startsWith("response=")) {
    throw new ThePayOneError("더페이원 결과 통지 본문이 올바르지 않습니다.", "INVALID_WEBHOOK");
  }
  const encoded = rawBody.slice("response=".length);
  let params = new URLSearchParams(encoded);
  if (!params.get("trxId") || !params.get("trackId")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(encoded.replace(/\+/g, "%20"));
    } catch {
      throw new ThePayOneError("더페이원 결과 통지를 디코딩하지 못했습니다.", "INVALID_WEBHOOK");
    }
    params = new URLSearchParams(decoded);
  }
  const transactionType = webhookString(params, "trxType", 20, true);
  if (transactionType !== "pay" && transactionType !== "refund") {
    throw new ThePayOneError("지원하지 않는 더페이원 거래 유형입니다.", "INVALID_WEBHOOK");
  }
  const amount = Number(webhookString(params, "amount", 13, true));
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new ThePayOneError("더페이원 결과 통지 금액이 올바르지 않습니다.", "INVALID_WEBHOOK");
  }
  const last4 = webhookString(params, "last4", 16);
  const installment = Number(webhookString(params, "installment", 2) || "0");
  if (
    !Number.isSafeInteger(installment)
    || installment < 0
    || installment > 36
    || installment === 1
  ) {
    throw new ThePayOneError("더페이원 결과 통지 할부개월이 올바르지 않습니다.", "INVALID_WEBHOOK");
  }
  return {
    merchantId: webhookString(params, "mchtId", 128, true)!,
    terminalId: webhookString(params, "tmnId", 64, true)!,
    transactionId: webhookString(params, "trxId", 128, true)!,
    trackId: webhookString(params, "trackId", 128, true)!,
    transactionType,
    amount,
    cardId: webhookString(params, "cardId", 256, true)!,
    last4: last4 && /^\d{4}$/.test(last4) ? last4 : null,
    issuer: webhookString(params, "issuer", 100),
    acquirer: webhookString(params, "acquirer", 100),
    cardType: webhookString(params, "cardType", 50),
    authCode: webhookString(params, "authCd", 32),
    capType: webhookString(params, "capType", 20),
    transactionDay: webhookString(params, "trxDay", 8),
    registeredDay: webhookString(params, "regDay", 8),
    registeredTime: webhookString(params, "regTime", 6),
    rootTransactionId: webhookString(params, "rootTrxId", 128),
    installmentMonths: installment,
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

export function cardTokenHash(cardId: string) {
  return createHash("sha256").update(cardId, "utf8").digest("hex");
}
