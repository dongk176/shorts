"use client";

import { nicepayLanguage } from "@/lib/i18n/config";
import { currentClientLocale } from "@/lib/i18n/errors";

export type NicepayCheckout = {
  clientId: string;
  sdkUrl: string;
  method: "card";
  orderId: string;
  amount: number;
  goodsName: string;
  returnUrl: string;
  buyerName?: string | null;
  buyerEmail?: string | null;
  buyerTel?: string | null;
};

type AuthNice = {
  requestPay(input: Record<string, unknown>): void | Promise<void>;
};

type NicepaySdkError = {
  errorMsg?: unknown;
};

declare global {
  interface Window {
    AUTHNICE?: AuthNice;
  }
}

let sdkPromise: Promise<AuthNice> | null = null;

function isAllowedSdkUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "pay.nicepay.co.kr"
      && url.pathname === "/v1/js/";
  } catch {
    return false;
  }
}

function loadNicepaySdk(url: string) {
  if (!isAllowedSdkUrl(url)) return Promise.reject(new Error("나이스페이 SDK 주소가 올바르지 않습니다."));
  if (window.AUTHNICE) return Promise.resolve(window.AUTHNICE);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<AuthNice>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`);
    const script = existing || document.createElement("script");
    const onLoad = () => window.AUTHNICE
      ? resolve(window.AUTHNICE)
      : reject(new Error("나이스페이 결제 SDK를 초기화하지 못했습니다."));
    const onError = () => reject(new Error("나이스페이 결제 SDK를 불러오지 못했습니다."));
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.src = url;
      script.async = true;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    sdkPromise = null;
    throw error;
  });
  return sdkPromise;
}

function nicepaySdkError(value: unknown) {
  const rawMessage = typeof value === "object"
    && value !== null
    && "errorMsg" in value
    ? (value as NicepaySdkError).errorMsg
    : null;
  const message = typeof rawMessage === "string"
    ? rawMessage.trim()
    : "나이스페이 결제창에서 오류가 발생했습니다.";
  return new Error(message || "나이스페이 결제창에서 오류가 발생했습니다.");
}

export async function requestNicepayOneTimePayment(checkout: NicepayCheckout) {
  const nicepay = await loadNicepaySdk(checkout.sdkUrl);
  let requestReturned = false;
  let startupError: Error | null = null;
  const result = nicepay.requestPay({
    clientId: checkout.clientId,
    method: checkout.method,
    orderId: checkout.orderId,
    amount: checkout.amount,
    goodsName: checkout.goodsName,
    returnUrl: checkout.returnUrl,
    buyerName: checkout.buyerName || undefined,
    buyerEmail: checkout.buyerEmail || undefined,
    buyerTel: checkout.buyerTel || undefined,
    useEscrow: false,
    currency: "KRW",
    cardQuota: "00",
    language: nicepayLanguage(currentClientLocale()),
    fnError: (value: unknown) => {
      const error = nicepaySdkError(value);
      if (!requestReturned) {
        startupError = error;
        return;
      }
      window.alert(error.message);
    },
  });
  requestReturned = true;
  if (startupError) throw startupError;
  await Promise.resolve(result);
}
