"use client";

import type { BillingCycle, PaidPlanCode } from "@/lib/contracts";
import { currentClientLocale, localizeApiError } from "@/lib/i18n/errors";

export class BillingClientError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number,
    readonly maxInstallmentMonths: number | null = null,
  ) {
    super(message);
    this.name = "BillingClientError";
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({})) as {
    detail?: string;
    code?: string;
    maxInstallmentMonths?: number;
  } & T;
  if (!response.ok) {
    const maxInstallmentMonths = (
      Number.isSafeInteger(value.maxInstallmentMonths)
      && Number(value.maxInstallmentMonths) >= 2
      && Number(value.maxInstallmentMonths) <= 36
    )
      ? Number(value.maxInstallmentMonths)
      : null;
    throw new BillingClientError(
      localizeApiError(value, response.status, currentClientLocale()),
      value.code || null,
      response.status,
      maxInstallmentMonths,
    );
  }
  return value;
}

export async function purchaseAddonWithSavedCard(input: {
  addonCode: string;
  expectedChargeAmountKrw: number;
  identityNumber: string;
  cardPassword: string;
  payerTel?: string;
}) {
  return postJson<{
    ok: true;
    orderId: string;
    addedMinutes: number;
    chargedAmountKrw: number;
  }>("/api/billing/addons/purchase", {
    addonCode: input.addonCode,
    requestId: crypto.randomUUID(),
    expectedChargeAmountKrw: input.expectedChargeAmountKrw,
    identityNumber: input.identityNumber,
    cardPassword: input.cardPassword,
    consent: true,
    ...(input.payerTel ? { payerTel: input.payerTel } : {}),
  });
}

export async function purchaseAddonWithManualCard(input: {
  requestId: string;
  addonCode: string;
  expectedChargeAmountKrw: number;
  payerName: string;
  payerEmail: string;
  payerTel: string;
  cardNumber: string;
  expiryYear: string;
  expiryMonth: string;
  identityNumber: string;
  cardPassword: string;
  declaredCardKind: "credit" | "debit_prepaid";
  installmentMonths: number;
  installmentCampaignId: string | null;
  installmentIssuerCode: string | null;
}) {
  return postJson<{
    ok: boolean;
    checkoutId: string;
    orderId?: string;
    addedMinutes?: number;
    chargedAmountKrw?: number;
    installmentMonths?: number;
    manualReview?: boolean;
  }>("/api/billing/addons/purchase", {
    paymentInputMode: "manual_direct",
    addonCode: input.addonCode,
    requestId: input.requestId,
    expectedChargeAmountKrw: input.expectedChargeAmountKrw,
    payerName: input.payerName,
    payerEmail: input.payerEmail,
    payerTel: input.payerTel,
    cardNumber: input.cardNumber,
    expiryYear: input.expiryYear,
    expiryMonth: input.expiryMonth,
    identityNumber: input.identityNumber,
    cardPassword: input.cardPassword,
    declaredCardKind: input.declaredCardKind,
    consent: true,
    installmentMonths: input.installmentMonths,
    installmentCampaignId: input.installmentCampaignId,
    installmentIssuerCode: input.installmentIssuerCode,
  });
}

export async function purchasePlanWithSavedCard(input: {
  mode: "subscribe" | "change_subscription";
  planCode: PaidPlanCode;
  billingCycle: BillingCycle;
  expectedChargeAmountKrw: number;
  identityNumber: string;
  cardPassword: string;
  payerTel?: string;
}) {
  return postJson<{
    ok: true;
    checkoutId?: string;
    orderId: string;
  }>("/api/billing/activate", {
    mode: input.mode === "subscribe"
      ? "subscribe_saved"
      : "change_subscription_saved",
    requestId: crypto.randomUUID(),
    planCode: input.planCode,
    billingCycle: input.billingCycle,
    expectedChargeAmountKrw: input.expectedChargeAmountKrw,
    identityNumber: input.identityNumber,
    cardPassword: input.cardPassword,
    consent: true,
    installmentMonths: 0,
    installmentCampaignId: null,
    ...(input.payerTel ? { payerTel: input.payerTel } : {}),
  });
}

export async function replaceStoredPaymentMethod(input: {
  requestId: string;
  payerName: string;
  payerEmail: string;
  payerTel: string;
  cardNumber: string;
  expiryYear: string;
  expiryMonth: string;
  identityNumber: string;
  cardPassword: string;
}) {
  return postJson<{
    ok: true;
    orderId: string;
    paymentMethodUpdated: true;
  }>("/api/billing/activate", {
    mode: "replace_payment_method",
    requestId: input.requestId,
    payerName: input.payerName,
    payerEmail: input.payerEmail,
    payerTel: input.payerTel,
    cardNumber: input.cardNumber,
    expiryYear: input.expiryYear,
    expiryMonth: input.expiryMonth,
    identityNumber: input.identityNumber,
    cardPassword: input.cardPassword,
    consent: true,
    installmentMonths: 0,
    installmentCampaignId: null,
  });
}

export { postJson as billingPostJson };
