import { describe, expect, it } from "vitest";
import {
  TOSS_PLAN_CATALOG,
  classifyTossSubscriptionChange,
  quoteImmediateTossChange,
  tossPlan,
} from "@/lib/toss-subscription";

describe("Toss subscription catalog", () => {
  it("contains only the approved 1, 6, and 12 month prices", () => {
    expect(TOSS_PLAN_CATALOG.map((plan) => [plan.code, plan.priceKrw])).toEqual([
      ["toss_easycut_pro_1m", 9_900],
      ["toss_easycut_pro_6m", 53_400],
      ["toss_easycut_pro_12m", 82_800],
      ["toss_starter_1m", 24_900],
      ["toss_starter_6m", 119_400],
      ["toss_starter_12m", 178_800],
      ["toss_expert_1m", 59_000],
      ["toss_expert_6m", 247_800],
      ["toss_expert_12m", 354_000],
    ]);
    expect(Math.max(...TOSS_PLAN_CATALOG.map((plan) => plan.priceKrw))).toBeLessThanOrEqual(432_000);
  });

  it("uses total contract value to choose immediate versus scheduled changes", () => {
    expect(classifyTossSubscriptionChange({
      currentPlanCode: "toss_expert_1m",
      targetPlanCode: "toss_starter_12m",
    })).toBe("immediate");
    expect(classifyTossSubscriptionChange({
      currentPlanCode: "toss_expert_12m",
      targetPlanCode: "toss_starter_12m",
    })).toBe("scheduled");
    expect(classifyTossSubscriptionChange({
      currentPlanCode: "toss_starter_6m",
      targetPlanCode: "toss_expert_1m",
    })).toBe("scheduled");
  });

  it("credits only the unused value of an immediate change", () => {
    const start = new Date("2026-08-01T00:00:00.000Z");
    const end = new Date("2026-09-01T00:00:00.000Z");
    const quote = quoteImmediateTossChange({
      currentPlanCode: "toss_expert_1m",
      targetPlanCode: "toss_starter_12m",
      currentPeriodStart: start,
      currentPeriodEnd: end,
      now: new Date("2026-08-16T12:00:00.000Z"),
    });
    expect(quote.action).toBe("immediate");
    expect(quote.unusedCreditKrw).toBe(29_500);
    expect(quote.chargeAmountKrw).toBe(tossPlan("toss_starter_12m").priceKrw - 29_500);
  });
});
