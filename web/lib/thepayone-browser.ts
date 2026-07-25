"use client";

export type ThePayOneCheckout = {
  checkoutId: string;
  sdkUrl: string;
  publicKey: string;
  amount: number;
  trackId: string;
  webhookUrl: string;
  udf1: string;
  udf2: string;
  payerName: string;
  payerEmail: string;
  payerTel: string;
  products: Array<{ name: string; price: string; qty: string; desc: string }>;
  pendingUrl: string;
};

type ThePayOneBrowserSdk = {
  debug(enabled: boolean): void;
  pay(input: Record<string, unknown>): void;
  cyrexpop?: () => void;
};

declare global {
  interface Window {
    TPO?: ThePayOneBrowserSdk;
  }
}

let sdkPromise: Promise<ThePayOneBrowserSdk> | null = null;

function initializeLateLoadedSdk(sdk: ThePayOneBrowserSdk) {
  if (
    typeof document === "undefined"
    || typeof sdk.cyrexpop !== "function"
    || document.getElementById("cyrexpop_iframe")
    || document.readyState === "loading"
  ) return sdk;
  // ThePayOne's clientside.js only initializes its iframe from a
  // DOMContentLoaded listener. A dynamically loaded script misses the browser's
  // original event, so replay it once for the provider SDK.
  document.dispatchEvent(new Event("DOMContentLoaded"));
  if (!document.getElementById("cyrexpop_iframe")) {
    throw new Error("더페이원 결제창을 초기화하지 못했습니다.");
  }
  return sdk;
}

function allowedSdkUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "api.thepayone.com"
      && url.pathname === "/js/clientside.js";
  } catch {
    return false;
  }
}

function loadSdk(url: string) {
  if (!allowedSdkUrl(url)) return Promise.reject(new Error("더페이원 SDK 주소가 올바르지 않습니다."));
  if (window.TPO) return Promise.resolve(initializeLateLoadedSdk(window.TPO));
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<ThePayOneBrowserSdk>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`);
    const script = existing || document.createElement("script");
    const onLoad = () => {
      if (!window.TPO) {
        reject(new Error("더페이원 결제 SDK를 초기화하지 못했습니다."));
        return;
      }
      try {
        resolve(initializeLateLoadedSdk(window.TPO));
      } catch (error) {
        reject(error);
      }
    };
    const onError = () => reject(new Error("더페이원 결제 SDK를 불러오지 못했습니다."));
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

export async function requestThePayOnePayment(checkout: ThePayOneCheckout) {
  const sdk = await loadSdk(checkout.sdkUrl);
  sdk.debug(false);
  sdk.pay({
    amount: String(checkout.amount),
    publicKey: checkout.publicKey,
    products: checkout.products,
    trackId: checkout.trackId,
    responseFunction: () => {
      window.location.assign(checkout.pendingUrl);
    },
    webhookUrl: checkout.webhookUrl,
    udf1: checkout.udf1,
    udf2: checkout.udf2,
    payerName: checkout.payerName,
    payerEmail: checkout.payerEmail,
    payerTel: checkout.payerTel,
  });
}
