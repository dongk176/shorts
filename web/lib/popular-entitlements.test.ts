import { describe, expect, it } from "vitest";
import {
  assertPopularFilterAccess,
  billingSupportsPopularFilters,
  POPULAR_FILTER_PLAN_MESSAGE,
} from "./popular-entitlements";

describe("popular filter entitlements", () => {
  it("allows an account with an active subscription or package", () => {
    const billing = {
      activeProducts: [{
        planCode: "easycut_pro_v2" as const,
        displayName: "이지컷 프로",
        billingCycle: "monthly" as const,
        currentPeriodStart: "2026-07-01T00:00:00.000Z",
        currentPeriodEnd: "2026-08-01T00:00:00.000Z",
        nextChargeAt: "2026-08-01T00:00:00.000Z",
        cancelAtPeriodEnd: false,
        monthlySourceSeconds: 3_600,
      }],
    };

    expect(billingSupportsPopularFilters(billing)).toBe(true);
    expect(() => assertPopularFilterAccess(billing)).not.toThrow();
  });

  it("blocks an account without a currently active paid product", () => {
    const billing = { activeProducts: [] };

    expect(billingSupportsPopularFilters(billing)).toBe(false);
    expect(() => assertPopularFilterAccess(billing)).toThrowError(
      POPULAR_FILTER_PLAN_MESSAGE,
    );
  });

  it("does not treat free welcome creation time as popular-filter access", () => {
    const welcomeBilling = { activeProducts: [], canCreateJobs: true };

    expect(billingSupportsPopularFilters(welcomeBilling)).toBe(false);
    expect(() => assertPopularFilterAccess(welcomeBilling)).toThrowError(
      POPULAR_FILTER_PLAN_MESSAGE,
    );
  });

  it("allows an account with time-limited direct filter access", () => {
    const billing = { activeProducts: [] };

    expect(billingSupportsPopularFilters(billing, true)).toBe(true);
    expect(() => assertPopularFilterAccess(billing, true)).not.toThrow();
  });

  it("keeps an explicit legacy override for accounts without managed full access", () => {
    const paidBilling = { activeProducts: [{ planCode: "pro" }] };

    expect(billingSupportsPopularFilters(paidBilling as never, true, false)).toBe(false);
    expect(() => assertPopularFilterAccess(paidBilling as never, true, false)).toThrowError(
      POPULAR_FILTER_PLAN_MESSAGE,
    );
    expect(billingSupportsPopularFilters({ activeProducts: [] }, false, true)).toBe(true);
  });

  it("allows filters for an active administrator-issued account", () => {
    const billing = {
      activeProducts: [],
      hasManagedFeatureAccess: true,
    };

    expect(billingSupportsPopularFilters(billing, false, false)).toBe(true);
    expect(() => assertPopularFilterAccess(billing, false, false)).not.toThrow();
  });
});
