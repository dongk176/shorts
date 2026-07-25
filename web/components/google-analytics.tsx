"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";

const ANALYTICS_CONSENT_KEY = "easycut:analytics-consent:2026-07-26";

type AnalyticsConsent = "accepted" | "rejected" | null;

declare global {
  interface Window {
    dataLayer?: unknown[][];
    gtag?: (...args: unknown[]) => void;
  }
}

export function isGoogleAnalyticsMeasurementId(value: string | undefined): value is string {
  return typeof value === "string" && /^G-[A-Z0-9]+$/.test(value);
}

function ensureGtag() {
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag(...args: unknown[]) {
    window.dataLayer?.push(args);
  };
  return window.gtag;
}

export function GoogleAnalytics({ measurementId }: { measurementId?: string }) {
  const pathname = usePathname();
  const { locale } = useI18n();
  const enabled = isGoogleAnalyticsMeasurementId(measurementId);
  const initializedMeasurementId = useRef<string | null>(null);
  const [consent, setConsent] = useState<AnalyticsConsent>(null);
  const [consentLoaded, setConsentLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    try {
      const stored = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
      setConsent(stored === "accepted" || stored === "rejected" ? stored : null);
    } catch {
      setConsent(null);
    } finally {
      setConsentLoaded(true);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || consent !== "accepted") return;
    const gtag = ensureGtag();
    if (initializedMeasurementId.current !== measurementId) {
      gtag("consent", "default", {
        analytics_storage: "granted",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
      gtag("js", new Date());
      gtag("config", measurementId, {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      });
      initializedMeasurementId.current = measurementId;
    }
    gtag("event", "page_view", {
      page_location: window.location.href,
      page_path: pathname,
      page_title: document.title,
    });
  }, [consent, enabled, measurementId, pathname]);

  if (!enabled) return null;

  const translations = {
    ko: {
      title: "선택 분석 쿠키 안내",
      description: "동의하면 방문·이용 흐름 정보가 Google Analytics를 통해 미국 등 국외에서 처리될 수 있습니다. 광고 기능은 사용하지 않으며, 거부해도 서비스 이용에는 영향이 없습니다.",
      accept: "분석 쿠키 동의",
      reject: "거부",
      details: "국외이전 상세 보기",
      settings: "분석 쿠키 설정",
    },
    en: {
      title: "Optional analytics cookies",
      description: "If you consent, visit and usage-flow data may be processed abroad, including in the United States, through Google Analytics. We do not use advertising features, and refusal does not affect the Service.",
      accept: "Accept analytics",
      reject: "Reject",
      details: "International transfer details",
      settings: "Analytics settings",
    },
    ja: {
      title: "任意の分析Cookie",
      description: "同意すると、訪問・利用動線の情報がGoogle Analyticsを通じて米国等の国外で処理される場合があります。広告機能は使用せず、拒否してもサービス利用に影響はありません。",
      accept: "分析Cookieに同意",
      reject: "拒否",
      details: "国外移転の詳細",
      settings: "分析Cookie設定",
    },
  }[locale];

  const chooseConsent = (next: Exclude<AnalyticsConsent, null>) => {
    try {
      window.localStorage.setItem(ANALYTICS_CONSENT_KEY, next);
    } catch {
      // Browsers may block storage in privacy-focused modes. The in-memory choice
      // still applies for the current page.
    }
    if (next === "rejected" && window.gtag) {
      window.gtag("consent", "update", { analytics_storage: "denied" });
    }
    setConsent(next);
  };

  return (
    <>
      {consent === "accepted" && (
        <Script
          id="easycut-google-analytics"
          src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
          strategy="afterInteractive"
        />
      )}
      {consentLoaded && consent === null && (
        <aside
          aria-label={translations.title}
          className="fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-3xl rounded-2xl border border-white/15 bg-[#171719]/[.98] p-5 text-white shadow-2xl backdrop-blur sm:flex sm:items-center sm:gap-5"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold">{translations.title}</p>
            <p className="mt-1 text-xs font-medium leading-5 text-neutral-300">
              {translations.description}{" "}
              <Link href="/privacy#international-transfers" className="font-bold text-[#ff8c7c] underline underline-offset-4">
                {translations.details}
              </Link>
            </p>
          </div>
          <div className="mt-4 flex shrink-0 gap-2 sm:mt-0">
            <button type="button" onClick={() => chooseConsent("rejected")} className="min-h-10 rounded-xl border border-white/15 px-4 text-xs font-bold text-neutral-200 transition hover:bg-white/[.06]">
              {translations.reject}
            </button>
            <button type="button" onClick={() => chooseConsent("accepted")} className="min-h-10 rounded-xl bg-white px-4 text-xs font-extrabold text-black transition hover:bg-neutral-200">
              {translations.accept}
            </button>
          </div>
        </aside>
      )}
      {consentLoaded && consent !== null && (
        <button
          type="button"
          onClick={() => setConsent(null)}
          className="fixed bottom-3 left-3 z-[90] rounded-lg border border-white/10 bg-black/75 px-3 py-2 text-[11px] font-bold text-neutral-300 backdrop-blur transition hover:border-white/25 hover:text-white"
        >
          {translations.settings}
        </button>
      )}
    </>
  );
}
