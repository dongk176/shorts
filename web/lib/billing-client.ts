"use client";

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

export { postJson as billingPostJson };
