import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGtagCommandQueue } from "@/lib/google-analytics-command-queue";

const implementation = readFileSync(
  new URL("./google-analytics.tsx", import.meta.url),
  "utf8",
);

describe("Google Analytics measurement", () => {
  it("initializes Firebase Analytics with cookieless measurement and no advertising signals", () => {
    expect(implementation).toContain('import("firebase/analytics")');
    expect(implementation).toContain("initializeAnalytics(app");
    expect(implementation).toContain('analytics_storage: "denied"');
    expect(implementation).toContain('ad_storage: "denied"');
    expect(implementation).toContain('ad_user_data: "denied"');
    expect(implementation).toContain('ad_personalization: "denied"');
    expect(implementation).toContain('client.logEvent(client.analytics, "page_view"');
    expect(implementation).toContain("allow_google_signals: false");
    expect(implementation).toContain("allow_ad_personalization_signals: false");
    expect(implementation).toContain("send_page_view: false");
    expect(implementation).not.toContain("clearLegacyAnalyticsState");
    expect(implementation).not.toContain("선택 분석 쿠키 안내");
    expect(implementation).not.toContain("ANALYTICS_CONSENT_KEY");
    expect(implementation).not.toContain("consentLoaded");
    expect(implementation).not.toContain('gtag("config"');
  });

  it("queues gtag commands as Arguments objects so the Google tag processes them", () => {
    const dataLayer: unknown[] = [];
    const gtag = createGtagCommandQueue(dataLayer);

    gtag("event", "page_view", { page_path: "/" });

    expect(dataLayer).toHaveLength(1);
    expect(Array.isArray(dataLayer[0])).toBe(false);
    expect(Array.from(dataLayer[0] as IArguments)).toEqual([
      "event",
      "page_view",
      { page_path: "/" },
    ]);
  });
});
