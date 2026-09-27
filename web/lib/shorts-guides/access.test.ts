import { describe, it, expect } from "vitest";
import { canDownloadStrategyGuides } from "./access";
import type { ActiveBillingProduct } from "@/lib/contracts";
const now = Date.parse("2026-09-27T00:00:00Z");
const product: ActiveBillingProduct = {
  planCode: "toss_easycut_pro_1m",
  displayName: "Pro",
  billingCycle: "monthly",
  currentPeriodStart: "2026-09-01T00:00:00Z",
  currentPeriodEnd: "2026-10-01T00:00:00Z",
  nextChargeAt: null,
  cancelAtPeriodEnd: false,
  monthlySourceSeconds: 3600,
};
describe("new strategy workbook access", () => {
  it("includes active paid Pro as well as package plans, including paid-through cancellation", () => {
    for (const code of ["toss_easycut_pro_1m", "starter_3m", "expert_12m"]) {
      expect(
        canDownloadStrategyGuides(
          {
            hasPaymentHistory: true,
            activeProducts: [
              { ...product, planCode: code, cancelAtPeriodEnd: true },
            ],
          },
          now,
        ),
      ).toBe(true);
    }
  });
  it("denies unpaid, expired, future, invalid and free entitlements", () => {
    expect(
      canDownloadStrategyGuides(
        { hasPaymentHistory: false, activeProducts: [product] },
        now,
      ),
    ).toBe(false);
    for (const p of [
      { ...product, currentPeriodEnd: "2026-09-27T00:00:00Z" },
      { ...product, currentPeriodStart: "2026-10-01T00:00:00Z" },
      { ...product, currentPeriodEnd: "invalid" },
      { ...product, planCode: "free" },
    ])
      expect(
        canDownloadStrategyGuides(
          { hasPaymentHistory: true, activeProducts: [p] },
          now,
        ),
      ).toBe(false);
    expect(
      canDownloadStrategyGuides(
        { hasPaymentHistory: true, activeProducts: [] },
        now,
      ),
    ).toBe(false);
  });
});
