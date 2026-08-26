import { describe, expect, it } from "vitest";
import {
  assertCustomTemplateAccess,
  billingSupportsCustomTemplates,
} from "@/lib/template-entitlements";
import { TOSS_PLAN_CATALOG } from "@/lib/toss-subscription";

describe("custom-template plan entitlements", () => {
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

  it("allows custom templates for every active Toss subscription plan", () => {
    for (const plan of TOSS_PLAN_CATALOG) {
      expect(billingSupportsCustomTemplates({
        activeProducts: [{
          planCode: plan.code,
          displayName: plan.displayName,
          billingCycle: "monthly",
          currentPeriodStart: "2026-08-01T00:00:00.000Z",
          currentPeriodEnd: "2026-09-01T00:00:00.000Z",
          nextChargeAt: "2026-09-01T00:00:00.000Z",
          cancelAtPeriodEnd: false,
          monthlySourceSeconds: plan.monthlyQuotaSeconds,
        }],
      })).toBe(true);
    }
  });

  it("allows custom templates for an active administrator-issued account", () => {
    const billing = {
      activeProducts: [],
      hasManagedFeatureAccess: true,
    };

    expect(billingSupportsCustomTemplates(billing)).toBe(true);
    expect(() => assertCustomTemplateAccess(billing)).not.toThrow();
  });
});
