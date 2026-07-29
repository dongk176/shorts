"use client";

import type { FirebaseOptions } from "firebase/app";
import type { Analytics } from "firebase/analytics";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { createGtagCommandQueue } from "@/lib/google-analytics-command-queue";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export type FirebaseAnalyticsConfig = {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  measurementId?: string;
};

type FirebaseAnalyticsClient = {
  analytics: Analytics;
  logEvent: typeof import("firebase/analytics")["logEvent"];
};

const analyticsClients = new Map<string, Promise<FirebaseAnalyticsClient | null>>();

export function isFirebaseAnalyticsConfig(
  config: FirebaseAnalyticsConfig,
): config is Required<FirebaseAnalyticsConfig> {
  return (
    Object.values(config).every((value) => typeof value === "string" && value.length > 0)
    && Object.keys(config).length === 7
    && /^G-[A-Z0-9]+$/.test(config.measurementId ?? "")
  );
}

function ensureGtag() {
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || createGtagCommandQueue(window.dataLayer);
  return window.gtag;
}

function consentSettings() {
  return {
    analytics_storage: "denied" as const,
    ad_storage: "denied" as const,
    ad_user_data: "denied" as const,
    ad_personalization: "denied" as const,
  };
}

async function initializeFirebaseAnalytics(
  config: Required<FirebaseAnalyticsConfig>,
): Promise<FirebaseAnalyticsClient | null> {
  const existingClient = analyticsClients.get(config.appId);
  if (existingClient) return existingClient;

  const clientPromise = (async () => {
    const gtag = ensureGtag();
    gtag("consent", "default", consentSettings());
    gtag("set", "ads_data_redaction", true);

    const [firebaseApp, firebaseAnalytics] = await Promise.all([
      import("firebase/app"),
      import("firebase/analytics"),
    ]);
    if (!(await firebaseAnalytics.isSupported())) return null;

    const options: FirebaseOptions = config;
    const app = firebaseApp.getApps().find((candidate) => candidate.options.appId === config.appId)
      ?? firebaseApp.initializeApp(options, "easycut-analytics");
    const analytics = firebaseAnalytics.initializeAnalytics(app, {
      config: {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      },
    });
    firebaseAnalytics.setConsent(consentSettings());

    return { analytics, logEvent: firebaseAnalytics.logEvent };
  })().catch((error: unknown) => {
    console.error("firebase_analytics_initialization_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  });

  analyticsClients.set(config.appId, clientPromise);
  return clientPromise;
}

export function FirebaseAnalytics({ config }: { config: FirebaseAnalyticsConfig }) {
  const pathname = usePathname();
  const {
    apiKey,
    appId,
    authDomain,
    measurementId,
    messagingSenderId,
    projectId,
    storageBucket,
  } = config;

  useEffect(() => {
    const currentConfig = {
      apiKey,
      appId,
      authDomain,
      measurementId,
      messagingSenderId,
      projectId,
      storageBucket,
    };
    if (!isFirebaseAnalyticsConfig(currentConfig)) return;
    let active = true;

    void initializeFirebaseAnalytics(currentConfig).then((client) => {
      if (!active || !client) return;
      client.logEvent(client.analytics, "page_view", {
        page_location: window.location.href,
        page_path: pathname,
        page_title: document.title,
      });
    });

    return () => {
      active = false;
    };
  }, [
    apiKey,
    appId,
    authDomain,
    measurementId,
    messagingSenderId,
    pathname,
    projectId,
    storageBucket,
  ]);

  return null;
}
