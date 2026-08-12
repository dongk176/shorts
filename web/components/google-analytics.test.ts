import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGtagCommandQueue } from "@/lib/google-analytics-command-queue";

const implementation = readFileSync(
  new URL("./google-analytics.tsx", import.meta.url),
  "utf8",
);
const layout = readFileSync(
  new URL("../app/layout.tsx", import.meta.url),
  "utf8",
);

describe("Google Analytics measurement", () => {
  it("loads the Google tag directly and sends explicit page views", () => {
    expect(implementation).toContain('from "next/script"');
    expect(implementation).toContain("https://www.googletagmanager.com/gtag/js?id=");
    expect(implementation).toContain('gtag("config", measurementId');
    expect(implementation).toContain('ensureGtag()("event", "page_view"');
    expect(implementation).toContain("allow_google_signals: false");
    expect(implementation).toContain("allow_ad_personalization_signals: false");
    expect(implementation).toContain("send_page_view: false");
    expect(implementation).not.toContain('import("firebase/analytics")');
  });

  it("grants analytics cookies while denying every advertising consent signal", () => {
    expect(layout).toContain('strategy="beforeInteractive"');
    expect(layout).toContain('analytics_storage:"granted"');
    expect(layout).toContain('ad_storage:"denied"');
    expect(layout).toContain('ad_user_data:"denied"');
    expect(layout).toContain('ad_personalization:"denied"');
    expect(layout).toContain('ads_data_redaction",true');
    expect(layout).not.toContain("ANALYTICS_CONSENT_KEY");
    expect(layout).not.toContain("consentLoaded");
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
