import { describe, expect, it } from "vitest";
import {
  assertCustomTemplateAccess,
  billingSupportsCustomTemplates,
  planSupportsCustomTemplates,
} from "@/lib/template-entitlements";

describe("custom-template plan entitlements", () => {
  it.each([
    ["free", true],
    ["plus", true],
    ["standard", true],
    ["pro", true],
  ] as const)("maps the %s plan to %s", (planCode, expected) => {
    expect(planSupportsCustomTemplates(planCode)).toBe(expected);
  });

  it("does not lock custom templates when a subscription is inactive", () => {
    expect(billingSupportsCustomTemplates({ planCode: "free", canCreateJobs: false })).toBe(true);
    expect(() => assertCustomTemplateAccess({ planCode: "free", canCreateJobs: false }))
      .not.toThrow();
  });
});
