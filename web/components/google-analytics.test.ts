import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const implementation = readFileSync(
  new URL("./google-analytics.tsx", import.meta.url),
  "utf8",
);

describe("Google Analytics measurement", () => {
  it("enables analytics without rendering a consent UI or enabling advertising signals", () => {
    expect(implementation).toContain('analytics_storage: "granted"');
    expect(implementation).toContain('ad_storage: "denied"');
    expect(implementation).toContain('ad_user_data: "denied"');
    expect(implementation).toContain('ad_personalization: "denied"');
    expect(implementation).toContain('src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}');
    expect(implementation).toContain('gtag("event", "page_view"');
    expect(implementation).not.toContain("clearLegacyAnalyticsState");
    expect(implementation).not.toContain("선택 분석 쿠키 안내");
    expect(implementation).not.toContain("ANALYTICS_CONSENT_KEY");
    expect(implementation).not.toContain("consentLoaded");
  });
});
