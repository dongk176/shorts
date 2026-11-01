import { describe, expect, it } from "vitest";
import {
  TOSS_PLAN_CATALOG,
  TOSS_NEW_PRO_PLAN_CODE,
  tossCatalogForSubscription,
  TOSS_SALE_PLAN_CATALOG,
  classifyTossSubscriptionChange,
  isTossPlanCode,
  isTossSalePlanCode,
  quoteImmediateTossChange,
  tossPlan,
} from "@/lib/toss-subscription";

describe("Toss subscription catalog", () => {
  it("sells only Pro monthly and the exact 3, 6, and 12 month package totals", () => {
    expect(TOSS_SALE_PLAN_CATALOG.map((plan) => [plan.code, plan.priceKrw])).toEqual([
      [TOSS_NEW_PRO_PLAN_CODE, 19_900],
      ["toss_starter_3m", 70_965],
      ["toss_starter_6m", 119_400],
      ["toss_starter_12m", 198_000],
      ["toss_expert_3m", 147_000],
      ["toss_expert_6m", 288_000],
      ["toss_expert_12m", 432_000],
    ]);
    expect(Math.max(...TOSS_SALE_PLAN_CATALOG.map((plan) => plan.priceKrw))).toBe(432_000);
  });

  it("keeps legacy EasyCut Pro contracts readable and renewable without selling them again", () => {
    expect(isTossPlanCode("toss_easycut_pro_6m")).toBe(true);
    expect(isTossPlanCode("toss_easycut_pro_12m")).toBe(true);
    expect(tossPlan("toss_easycut_pro_6m").priceKrw).toBe(53_400);
    expect(isTossSalePlanCode("toss_easycut_pro_6m")).toBe(false);
    expect(isTossSalePlanCode("toss_easycut_pro_12m")).toBe(false);
    expect(isTossSalePlanCode("toss_starter_1m")).toBe(false);
    expect(isTossSalePlanCode("toss_expert_1m")).toBe(false);
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

  it("classifies all plan-change combinations with the production total-value rule", () => {
    const counts = { unchanged: 0, immediate: 0, scheduled: 0 };
    for (const current of TOSS_PLAN_CATALOG) {
      for (const target of TOSS_PLAN_CATALOG) {
        const action = classifyTossSubscriptionChange({
          currentPlanCode: current.code,
          targetPlanCode: target.code,
        });
        counts[action] += 1;
        if (current.code === target.code) {
          expect(action).toBe("unchanged");
        } else if (target.priceKrw > current.priceKrw) {
          expect(action).toBe("immediate");
        } else {
          expect(action).toBe("scheduled");
        }
      }
    }
    expect(counts).toEqual({ unchanged: 12, immediate: 66, scheduled: 66 });
  });

  it("charges only the contract-value difference for an immediate change at period start", () => {
    const start = new Date("2026-08-01T00:00:00.000Z");
    const end = new Date("2026-09-01T00:00:00.000Z");
    for (const current of TOSS_PLAN_CATALOG) {
      for (const target of TOSS_PLAN_CATALOG) {
        if (target.priceKrw <= current.priceKrw) continue;
        const quote = quoteImmediateTossChange({
          currentPlanCode: current.code,
          targetPlanCode: target.code,
          currentPeriodStart: start,
          currentPeriodEnd: end,
          now: start,
        });
        expect(quote.action).toBe("immediate");
        expect(quote.unusedCreditKrw).toBe(current.priceKrw);
        expect(quote.chargeAmountKrw).toBe(target.priceKrw - current.priceKrw);
      }
    }
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

it("preserves existing Pro renewal identity and price while new purchases use 19,900", () => {
 expect(tossPlan("toss_easycut_pro_1m").priceKrw).toBe(9900);
 expect(isTossSalePlanCode("toss_easycut_pro_1m")).toBe(false);
 expect(tossPlan(TOSS_NEW_PRO_PLAN_CODE)).toMatchObject({priceKrw:19900,monthlyEquivalentKrw:19900,monthlyQuotaSeconds:3600,maxActiveJobs:1});
 expect(tossCatalogForSubscription("toss_easycut_pro_1m").find(p=>p.tier==='easycut_pro')).toMatchObject({code:'toss_easycut_pro_1m',priceKrw:9900});
 expect(tossCatalogForSubscription().find(p=>p.tier==='easycut_pro')).toMatchObject({code:TOSS_NEW_PRO_PLAN_CODE,priceKrw:19900});
});
