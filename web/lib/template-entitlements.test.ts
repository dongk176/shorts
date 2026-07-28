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
    expect(billingSupportsCustomTemplates({ activeProducts: [] })).toBe(false);
    expect(() => assertCustomTemplateAccess({ activeProducts: [] }))
      .toThrow("활성 유료 플랜");
  });

  it("requires the paid period to be active", () => {
    expect(billingSupportsCustomTemplates({ activeProducts: [] })).toBe(false);
    expect(billingSupportsCustomTemplates({
      activeProducts: [{
        planCode: "starter_3m",
        displayName: "스타터",
        billingCycle: "yearly",
        currentPeriodStart: "2026-07-01T00:00:00.000Z",
        currentPeriodEnd: "2026-08-01T00:00:00.000Z",
        nextChargeAt: null,
        cancelAtPeriodEnd: false,
        monthlySourceSeconds: 12_000,
      }],
    })).toBe(true);
  });
});
