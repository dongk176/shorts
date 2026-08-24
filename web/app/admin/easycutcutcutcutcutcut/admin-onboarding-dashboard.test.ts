import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  new URL("./admin-onboarding-dashboard.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("administrator onboarding acquisition analysis", () => {
  it("shows discovery-source distribution and each member response", () => {
    expect(dashboardSource).toContain("유입 경로 분포");
    expect(dashboardSource).toContain("유입 경로");
    expect(dashboardSource).toContain("discoverySourceCounts");
    expect(pageSource).toContain("p.discovery_source,p.discovery_source_other");
    expect(pageSource).toContain("onboardingDiscoverySourceCounts");
  });

  it("renders legacy responses without a discovery source as a dash", () => {
    expect(dashboardSource).toMatch(
      /response\.discoverySource[\s\S]*?: "-"/,
    );
  });
});
