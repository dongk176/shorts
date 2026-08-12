import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalStyles = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const pricingStyles = readFileSync(
  new URL("./pricing/pricing.module.css", import.meta.url),
  "utf8",
);
const pricingShell = readFileSync(
  new URL("./pricing/pricing-page-shell.tsx", import.meta.url),
  "utf8",
);

describe("pricing mobile overflow", () => {
  it("clips page-level horizontal decoration without disabling table scrolling", () => {
    expect(pricingStyles).toMatch(/\.page:global\(\.pricing-page\)\s*\{[^}]*overflow-x:\s*clip;[^}]*overflow-y:\s*visible;/);
    expect(pricingShell).toContain("${styles.page}");
    expect(globalStyles).toMatch(/\.pricing-comparison-table-wrap\s*\{[^}]*overflow-x:\s*auto;/);
  });
});
