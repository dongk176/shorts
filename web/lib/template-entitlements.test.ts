import { describe, expect, it } from "vitest";
import {
  assertCustomTemplateAccess,
  billingSupportsCustomTemplates,
  planSupportsCustomTemplates,
} from "@/lib/template-entitlements";

describe("custom-template plan entitlements", () => {
  it.each([
    ["free", false],
    ["plus", true],
    ["standard", true],
    ["pro", true],
  ] as const)("maps the %s plan to %s", (planCode, expected) => {
    expect(planSupportsCustomTemplates(planCode)).toBe(expected);
  });

  it("locks custom templates when a subscription is inactive", () => {
    expect(billingSupportsCustomTemplates({ planCode: "free", canCreateJobs: false })).toBe(false);
    expect(() => assertCustomTemplateAccess({ planCode: "free", canCreateJobs: false }))
      .toThrow("활성 유료 플랜");
  });

  it("requires the paid period to be active", () => {
    expect(billingSupportsCustomTemplates({ planCode: "standard", canCreateJobs: false })).toBe(false);
    expect(billingSupportsCustomTemplates({ planCode: "standard", canCreateJobs: true })).toBe(true);
  });
});
