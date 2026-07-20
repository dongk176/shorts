"use client";

import { loadTossPayments } from "@tosspayments/tosspayments-sdk";
import type { BillingCycle, PaidPlanCode } from "@/lib/contracts";

type Checkout = {
  checkoutId: string;
  clientKey: string;
  customerKey: string;
  orderId: string;
  orderName: string;
  amount: number;
  customerEmail: string | null;
  customerName: string | null;
  successUrl: string;
  failUrl: string;
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({})) as { detail?: string } & T;
  if (!response.ok) throw new Error(value.detail || "결제 요청을 처리하지 못했습니다.");
  return value;
}

export async function requestSubscriptionBillingAuth(input:
  | { mode: "subscribe"; planCode: PaidPlanCode; billingCycle: BillingCycle }
  | { mode: "replace_payment_method" }
) {
  const checkout = await postJson<Checkout>("/api/billing/checkout", {
    ...input,
    requestId: crypto.randomUUID(),
  });
  const tossPayments = await loadTossPayments(checkout.clientKey);
  const payment = tossPayments.payment({ customerKey: checkout.customerKey });
  await payment.requestBillingAuth({
    method: "CARD",
    successUrl: checkout.successUrl,
    failUrl: checkout.failUrl,
    customerEmail: checkout.customerEmail || undefined,
    customerName: checkout.customerName || undefined,
  });
}

export async function requestAddonPayment(addonCode: string) {
  const checkout = await postJson<Checkout>("/api/billing/addons/checkout", {
    addonCode,
    requestId: crypto.randomUUID(),
  });
  const tossPayments = await loadTossPayments(checkout.clientKey);
  const payment = tossPayments.payment({ customerKey: checkout.customerKey });
  await payment.requestPayment({
    method: "CARD",
    amount: { currency: "KRW", value: checkout.amount },
    orderId: checkout.orderId,
    orderName: checkout.orderName,
    successUrl: checkout.successUrl,
    failUrl: checkout.failUrl,
    customerEmail: checkout.customerEmail || undefined,
    customerName: checkout.customerName || undefined,
    card: {
      flowMode: "DEFAULT",
      useEscrow: false,
      useCardPoint: false,
    },
  });
}

export { postJson as billingPostJson };
