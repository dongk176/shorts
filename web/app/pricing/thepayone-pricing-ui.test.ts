import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pricingSource = readFileSync(
  new URL("./pricing-client.tsx", import.meta.url),
  "utf8",
);
const pricingStyles = readFileSync(
  new URL("./pricing.module.css", import.meta.url),
  "utf8",
);

describe("ThePayOne pricing UI", () => {
  it("keeps every active-product class used by the legacy pricing client", () => {
    const activeProductClasses = [
      "activeProductsSection",
      "activeProductsGrid",
      "activeProductCard",
      "activePackageCard",
      "activeProductTopline",
      "activeProductBadge",
      "activeProductBenefit",
      "subscriptionAction",
    ];

    for (const className of activeProductClasses) {
      expect(pricingSource).toContain(`styles.${className}`);
      expect(pricingStyles).toContain(`.${className}`);
    }
  });

  it("keeps a minimum CTA gap scoped to legacy plan cards", () => {
    expect(pricingStyles).toMatch(
      /\.planGrid \.planCard ul\s*\{[^}]*margin-bottom:\s*24px;/,
    );
    expect(pricingStyles).toMatch(
      /\.planCta\s*\{[^}]*margin-top:\s*auto;/,
    );
    expect(pricingStyles).not.toMatch(
      /\.localPlanGrid \.planCard ul\s*\{[^}]*margin-bottom:\s*24px;/,
    );
  });
});
