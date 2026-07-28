import { describe, expect, it } from "vitest";
import {
  assertEbookDownloadAccess,
  billingSupportsEbookDownloads,
  downloadableEbookSlugs,
} from "./ebook-entitlements";

describe("ebook download entitlements", () => {
  it("includes every ebook offered in the pricing package", () => {
    expect(downloadableEbookSlugs).toEqual([
      "monetization-7",
      "multi-platform",
      "copyright-survival",
      "monetization-playbook",
      "viral-formula",
      "low-views-diagnosis",
      "title-300",
    ]);
  });

  it.each([
    ["plus", "monthly", false],
    ["plus", "yearly", false],
    ["standard", "monthly", false],
    ["pro", "monthly", false],
    ["starter_3m", "yearly", true],
    ["starter_6m", "yearly", true],
    ["expert_12m", "yearly", true],
  ] as const)("maps an active %s %s product to %s", (planCode, billingCycle, expected) => {
    expect(billingSupportsEbookDownloads({
      activeProducts: [{
        planCode,
        displayName: planCode,
        billingCycle,
        currentPeriodStart: "2026-07-01T00:00:00.000Z",
        currentPeriodEnd: "2026-08-01T00:00:00.000Z",
        nextChargeAt: null,
        cancelAtPeriodEnd: false,
        monthlySourceSeconds: 3_600,
      }],
    })).toBe(expected);
  });

  it("rejects non-entitled plans at the server boundary", () => {
    expect(() => assertEbookDownloadAccess({ activeProducts: [] }))
      .toThrow("기간 패키지");
  });
});
