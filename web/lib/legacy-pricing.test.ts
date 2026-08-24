import { describe, expect, it } from "vitest";
import { discountedMonthlyPrice, estimatedMonthlyShortCount, pricingPlans, usageAddOns, yearlyCharge } from "./legacy-pricing";

describe("legacy pricing compatibility", () => {
  it("keeps the approved monthly prices and processing limits", () => {
    expect(pricingPlans.map(({ code, monthly, minutes }) => ({ code, monthly, minutes }))).toEqual([
      { code: "plus", monthly: 9_900, minutes: 100 },
      { code: "standard", monthly: 19_900, minutes: 200 },
      { code: "pro", monthly: 49_900, minutes: 600 },
    ]);
  });

  it("applies an exact 20 percent discount to annual plans", () => {
    expect(pricingPlans.map((plan) => discountedMonthlyPrice(plan.monthly))).toEqual([7_920, 15_920, 39_920]);
    expect(pricingPlans.map((plan) => yearlyCharge(plan.monthly))).toEqual([95_040, 191_040, 479_040]);
  });

  it("estimates monthly shorts from ten-minute source videos", () => {
    expect(pricingPlans.map((plan) => estimatedMonthlyShortCount(plan.minutes))).toEqual([80, 160, 480]);
  });

  it("keeps the approved one-time add-on packages", () => {
    expect(usageAddOns).toEqual([
      { code: "minutes_50", minutes: 50, price: 5_900 },
      { code: "minutes_100", minutes: 100, price: 9_900, badge: "가장 많이 선택" },
      { code: "minutes_300", minutes: 300, price: 24_900, badge: "분당 최저가" },
    ]);
  });
});
