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

  it("allows an account with time-limited direct filter access", () => {
    const billing = { activeProducts: [] };

    expect(billingSupportsPopularFilters(billing, true)).toBe(true);
    expect(() => assertPopularFilterAccess(billing, true)).not.toThrow();
  });
});
