"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect, useRef } from "react";

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

function clearLegacyAnalyticsState() {
  try {
    window.localStorage.removeItem("easycut:analytics-consent:2026-07-26");
  } catch {
    // Storage can be unavailable in privacy-focused browser modes.
  }

  const analyticsCookieNames = document.cookie
    .split(";")
    .map((cookie) => cookie.split("=", 1)[0]?.trim())
    .filter((name): name is string => Boolean(name && (name === "_ga" || name.startsWith("_ga_"))));
  if (analyticsCookieNames.length === 0) return;

  const hostnameParts = window.location.hostname.split(".");
  const domainCandidates = hostnameParts.length > 1
    ? hostnameParts
        .slice(0, -1)
        .map((_, index) => hostnameParts.slice(index).join("."))
    : [];

  for (const name of analyticsCookieNames) {
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    for (const domain of domainCandidates) {
      document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${domain}; SameSite=Lax`;
    }
  }
}

export function GoogleAnalytics({ measurementId }: { measurementId?: string }) {
  const pathname = usePathname();
  const enabled = isGoogleAnalyticsMeasurementId(measurementId);
  const initializedMeasurementId = useRef<string | null>(null);

  useEffect(() => {
    clearLegacyAnalyticsState();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const gtag = ensureGtag();
    if (initializedMeasurementId.current !== measurementId) {
      gtag("consent", "default", {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
      gtag("set", "ads_data_redaction", true);
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
  }, [enabled, measurementId, pathname]);

  if (!enabled) return null;

  return (
    <Script
      id="easycut-google-analytics"
      src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
      strategy="afterInteractive"
    />
  );
}
