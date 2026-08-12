"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createGtagCommandQueue } from "@/lib/google-analytics-command-queue";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const configuredMeasurementIds = new Set<string>();

function isGoogleAnalyticsMeasurementId(value?: string): value is string {
  return typeof value === "string" && /^G-[A-Z0-9]+$/.test(value);
}

function ensureGtag() {
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || createGtagCommandQueue(window.dataLayer);
  return window.gtag;
}

export function GoogleAnalyticsMeasurement({ measurementId }: { measurementId?: string }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const lastPageLocationRef = useRef<string | null>(null);

  const configure = useCallback(() => {
    if (!isGoogleAnalyticsMeasurementId(measurementId)) return;

    const gtag = ensureGtag();
    if (!configuredMeasurementIds.has(measurementId)) {
      gtag("js", new Date());
      gtag("config", measurementId, {
        send_page_view: false,
        anonymize_ip: true,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      });
      configuredMeasurementIds.add(measurementId);
    }
    setReady(true);
  }, [measurementId]);

  useEffect(() => {
    if (!ready || !isGoogleAnalyticsMeasurementId(measurementId)) return;

    const pageLocation = window.location.href;
    if (lastPageLocationRef.current === pageLocation) return;

    ensureGtag()("event", "page_view", {
      page_location: pageLocation,
      page_path: pathname,
      page_title: document.title,
    });
    lastPageLocationRef.current = pageLocation;
  }, [measurementId, pathname, ready]);

  if (!isGoogleAnalyticsMeasurementId(measurementId)) return null;

  return (
    <Script
      id="easycut-google-analytics-loader"
      src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`}
      strategy="afterInteractive"
      onReady={configure}
      onError={() => {
        console.error("google_analytics_script_load_failed");
      }}
    />
  );
}
