"use client";

import type { BillingCycle, PaidPlanCode } from "@/lib/contracts";
import { currentClientLocale, localizeApiError } from "@/lib/i18n/errors";

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({})) as { detail?: string; code?: string } & T;
  if (!response.ok) throw new Error(localizeApiError(value, response.status, currentClientLocale()));
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
