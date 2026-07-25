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
    ["free", null, false, false],
    ["free", "yearly", true, false],
    ["plus", "monthly", true, false],
    ["plus", "yearly", true, false],
    ["standard", "monthly", true, false],
    ["pro", "monthly", true, false],
    ["standard", "yearly", true, false],
    ["pro", "yearly", true, false],
    ["starter_3m", "yearly", true, true],
    ["starter_6m", "yearly", true, true],
    ["expert_12m", "yearly", true, true],
    ["standard", "yearly", false, false],
  ] as const)("maps %s %s active=%s to %s", (planCode, billingCycle, canCreateJobs, expected) => {
    expect(billingSupportsEbookDownloads({ planCode, billingCycle, canCreateJobs })).toBe(expected);
  });

  it("rejects non-entitled plans at the server boundary", () => {
    expect(() => assertEbookDownloadAccess({ planCode: "standard", billingCycle: "monthly", canCreateJobs: true }))
      .toThrow("기간 패키지");
  });
});
