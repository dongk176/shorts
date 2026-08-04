import { describe, expect, it } from "vitest";
import {
  canStackPricingV2Package,
  getPricingV2Plan,
  getPricingV2Package,
  isEasycutProPackageReplacement,
  pricingV2EarlyBirdProducts,
  pricingV2PackageMonths,
} from "./pricing-v2";

describe("pricing v2 catalog", () => {
  it("uses recurring billing only for Easy Cut Pro", () => {
    expect(getPricingV2Plan("easycut_pro_v2")).toMatchObject({
      kind: "subscription",
      billingCycle: "monthly",
    });
    for (const months of pricingV2PackageMonths) {
      expect(getPricingV2Package("starter", months)).toMatchObject({
        kind: "package",
        billingCycle: "yearly",
        durationMonths: months,
      });
      expect(getPricingV2Package("expert", months)).toMatchObject({
        kind: "package",
        billingCycle: "yearly",
        durationMonths: months,
      });
    }
  });

  it("keeps the target six- and twelve-month packages cheaper per minute than early-bird time", () => {
    const cheapestEarlyBirdUnitPrice = Math.min(
      ...pricingV2EarlyBirdProducts.map((product) => product.priceKrw / product.minutes),
    );
    for (const months of pricingV2PackageMonths) {
      for (const tier of ["starter", "expert"] as const) {
        if (tier === "starter" && months === 3) continue;
        const product = getPricingV2Package(tier, months);
        expect(product).not.toBeNull();
        expect(product!.totalPriceKrw / (product!.monthlyMinutes * months))
          .toBeLessThan(cheapestEarlyBirdUnitPrice);
      }
    }
  });

  it("keeps expert unit pricing below every starter option", () => {
    const starterUnitPrices = pricingV2PackageMonths.map((months) => {
      const product = getPricingV2Package("starter", months)!;
      return product.totalPriceKrw / (product.monthlyMinutes * months);
    });
    const expertUnitPrices = pricingV2PackageMonths.map((months) => {
      const product = getPricingV2Package("expert", months)!;
      return product.totalPriceKrw / (product.monthlyMinutes * months);
    });
    expect(Math.max(...expertUnitPrices)).toBeLessThan(Math.min(...starterUnitPrices));
  });

  it("uses a 19,900 won six-month anchor and a 34 percent twelve-month discount", () => {
    const threeMonths = getPricingV2Package("starter", 3)!;
    const sixMonths = getPricingV2Package("starter", 6)!;
    const twelveMonths = getPricingV2Package("starter", 12)!;
    expect([
      threeMonths.discountPercent,
      sixMonths.discountPercent,
      twelveMonths.discountPercent,
    ]).toEqual([5, 20, 34]);
    expect(threeMonths.monthlyPriceKrw).toBe(23_655);
    expect(threeMonths.totalPriceKrw).toBe(70_965);
    expect(sixMonths.monthlyPriceKrw).toBe(19_900);
    expect(sixMonths.totalPriceKrw).toBe(119_400);
    expect(twelveMonths.monthlyPriceKrw).toBe(16_500);
    expect(twelveMonths.totalPriceKrw).toBe(198_000);
  });

  it("allows different prepaid package products to stack but not the same product twice", () => {
    expect(canStackPricingV2Package("expert_3m", "expert_3m")).toBe(false);
    expect(canStackPricingV2Package("starter_3m", "starter_6m")).toBe(true);
    expect(canStackPricingV2Package("starter_6m", "expert_12m")).toBe(true);
    expect(canStackPricingV2Package("easycut_pro_v2", "starter_6m")).toBe(false);
    expect(canStackPricingV2Package("starter_6m", "easycut_pro_v2")).toBe(false);
  });

  it("recognizes only Easycut Pro to package replacements", () => {
    expect(isEasycutProPackageReplacement("easycut_pro_v2", "starter_6m")).toBe(true);
    expect(isEasycutProPackageReplacement("easycut_pro_v2", "expert_12m")).toBe(true);
    expect(isEasycutProPackageReplacement("starter_3m", "starter_6m")).toBe(false);
    expect(isEasycutProPackageReplacement("plus", "starter_6m")).toBe(false);
    expect(isEasycutProPackageReplacement("easycut_pro_v2", "easycut_pro_v2")).toBe(false);
  });
});
