import { expect, it } from "vitest";
import {
  currentPriceVersion, isNewCheckoutPlan, newPaddlePlanCode, paddleAmount,
  paddleDiscount, paddleDisplayPlans, paddleInitialTerm, paddlePlans,
} from "./catalog";
import { livePaddlePrices } from "./live-prices";

it.each([
  ["USD", 3, [999, 6897, 16497], [null, null]],
  ["USD", 6, [999, 11394, 29994], [17, 9]],
  ["USD", 12, [999, 17988, 47988], [34, 27]],
  ["JPY", 3, [980, 6870, 16470], [null, null]],
  ["JPY", 6, [980, 11340, 29940], [17, 9]],
  ["JPY", 12, [980, 17880, 47880], [34, 27]],
] as const)("shows the checkout amounts and savings for %s at %i months", (currency, months, totals, discounts) => {
  const plans = paddleDisplayPlans(months, currency);
  expect(plans.map(p => paddleAmount(p.code, currency))).toEqual(totals);
  expect(plans.map(p => p.billingMonths)).toEqual([1, months, months]);
  expect(plans.slice(1).map(p => {
    const discount = paddleDiscount(p.code, currency);
    return discount && Math.floor(discount.percent);
  })).toEqual(discounts);
  for (const plan of plans) {
    expect(isNewCheckoutPlan(plan.code, currency)).toBe(true);
    expect(newPaddlePlanCode(plan.code.replace(currentPriceVersion, ""), currency)).toBe(plan.code);
    expect(livePaddlePrices[plan.code][currency]).toMatch(/^pri_[a-z0-9]{26}$/);
  }
});

it("retains historical contract prices for renewals and plan management", () => {
  for (const plan of paddlePlans.filter(p => !p.code.endsWith(currentPriceVersion))) {
    for (const currency of ["USD", "JPY"] as const) {
      expect(isNewCheckoutPlan(plan.code, currency)).toBe(false);
    }
  }
  expect(paddleDisplayPlans(6, "USD", "paddle_lite").map(p => p.usd)).toEqual([399, 7194, 20994]);
  expect(paddleDisplayPlans(6, "JPY", "paddle_lite").map(p => p.jpy)).toEqual([590, 10740, 29940]);
  expect(paddleDisplayPlans(6, "JPY", "paddle_lite_jpy_20261021").map(p => p.jpy)).toEqual([750, 11340, 29940]);
  expect(paddleDisplayPlans(6, "JPY", "paddle_lite_v20261105").map(p => p.jpy)).toEqual([1900, 17940, 52900]);
  expect(paddleAmount("paddle_lite_v20261105", "USD")).toBe(1200);
  expect(paddleInitialTerm()).toBe(6);
});
