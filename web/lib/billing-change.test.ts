import { describe, expect, it } from "vitest";
import {
  activatedSubscriptionBillingAnchorDay,
  classifySubscriptionChange,
  monthlyUpgradeBaseGrantSeconds,
  quoteMonthlyUpgradeRefund,
  quoteSubscriptionChange,
  shouldPauseRecurringPaymentMethod,
} from "./billing-change";

const plus = { monthlyPriceKrw: 9_900, yearlyPriceKrw: 95_040 };
const standard = { monthlyPriceKrw: 19_900, yearlyPriceKrw: 191_040 };
const pro = { monthlyPriceKrw: 49_900, yearlyPriceKrw: 479_040 };
const periodStart = new Date("2026-07-01T00:00:00.000Z");
const now = new Date("2026-07-16T00:00:00.000Z");
const periodEnd = new Date("2026-07-31T00:00:00.000Z");
const monthlyPeriodEnd = new Date("2026-08-16T00:00:00.000Z");
const annualPeriodEnd = new Date("2027-07-16T00:00:00.000Z");

describe("subscription change policy", () => {
  it("does not persist a recurring billing anchor when Pro becomes a prepaid package", () => {
    expect(activatedSubscriptionBillingAnchorDay({
      billingCycle: "yearly",
      providerBillingDay: "00",
      currentBillingAnchorDay: 4,
      activatedAt: new Date("2026-08-04T05:56:30.000Z"),
    })).toBeNull();
  });

  it("keeps a valid monthly billing anchor", () => {
    expect(activatedSubscriptionBillingAnchorDay({
      billingCycle: "monthly",
      providerBillingDay: "04",
      currentBillingAnchorDay: 4,
      activatedAt: new Date("2026-08-04T05:56:30.000Z"),
    })).toBe(4);
  });

  it("falls back to a valid KST day for a monthly activation", () => {
    expect(activatedSubscriptionBillingAnchorDay({
      billingCycle: "monthly",
      providerBillingDay: "00",
      activatedAt: new Date("2026-08-30T15:00:00.000Z"),
    })).toBe(28);
  });

  it("stops every potentially live ThePayOne recurring schedule", () => {
    expect(shouldPauseRecurringPaymentMethod({
      provider: "thepayone",
      providerScheduleStatus: "active",
    })).toBe(true);
    expect(shouldPauseRecurringPaymentMethod({
      provider: "thepayone",
      providerScheduleStatus: "manual_review",
    })).toBe(true);
    expect(shouldPauseRecurringPaymentMethod({
      provider: "thepayone",
      providerScheduleStatus: "paused",
    })).toBe(false);
  });

  it("covers every plan and billing-cycle transition", () => {
    const states = [
      ["plus", "monthly"],
      ["standard", "monthly"],
      ["pro", "monthly"],
      ["plus", "yearly"],
      ["standard", "yearly"],
      ["pro", "yearly"],
    ] as const;
    const expected = [
      ["unchanged", "immediate_proration", "immediate_proration", "immediate_annual_conversion", "immediate_annual_conversion", "immediate_annual_conversion"],
      ["scheduled", "unchanged", "immediate_proration", "scheduled", "immediate_annual_conversion", "immediate_annual_conversion"],
      ["scheduled", "scheduled", "unchanged", "scheduled", "scheduled", "immediate_annual_conversion"],
      ["scheduled", "scheduled", "scheduled", "unchanged", "immediate_proration", "immediate_proration"],
      ["scheduled", "scheduled", "scheduled", "scheduled", "unchanged", "immediate_proration"],
      ["scheduled", "scheduled", "scheduled", "scheduled", "scheduled", "unchanged"],
    ] as const;

    states.forEach(([currentPlanCode, currentBillingCycle], currentIndex) => {
      states.forEach(([targetPlanCode, targetBillingCycle], targetIndex) => {
        expect(classifySubscriptionChange({
          currentPlanCode,
          currentBillingCycle,
          targetPlanCode,
          targetBillingCycle,
        }), `${currentPlanCode}/${currentBillingCycle} -> ${targetPlanCode}/${targetBillingCycle}`)
          .toBe(expected[currentIndex][targetIndex]);
      });
    });
  });

  it("applies same-cycle upgrades immediately", () => {
    expect(classifySubscriptionChange({
      currentPlanCode: "plus",
      currentBillingCycle: "monthly",
      targetPlanCode: "standard",
      targetBillingCycle: "monthly",
    })).toBe("immediate_proration");
    expect(classifySubscriptionChange({
      currentPlanCode: "standard",
      currentBillingCycle: "yearly",
      targetPlanCode: "pro",
      targetBillingCycle: "yearly",
    })).toBe("immediate_proration");
  });

  it("applies monthly-to-yearly changes immediately only for the same or higher tier", () => {
    expect(classifySubscriptionChange({
      currentPlanCode: "plus",
      currentBillingCycle: "monthly",
      targetPlanCode: "plus",
      targetBillingCycle: "yearly",
    })).toBe("immediate_annual_conversion");
    expect(classifySubscriptionChange({
      currentPlanCode: "standard",
      currentBillingCycle: "monthly",
      targetPlanCode: "plus",
      targetBillingCycle: "yearly",
    })).toBe("scheduled");
  });

  it("schedules every tier downgrade and every yearly-to-monthly change", () => {
    expect(classifySubscriptionChange({
      currentPlanCode: "pro",
      currentBillingCycle: "monthly",
      targetPlanCode: "standard",
      targetBillingCycle: "monthly",
    })).toBe("scheduled");
    expect(classifySubscriptionChange({
      currentPlanCode: "plus",
      currentBillingCycle: "yearly",
      targetPlanCode: "pro",
      targetBillingCycle: "monthly",
    })).toBe("scheduled");
  });

  it("replaces Easycut Pro with a prepaid package immediately", () => {
    expect(classifySubscriptionChange({
      currentPlanCode: "easycut_pro_v2",
      currentBillingCycle: "monthly",
      targetPlanCode: "starter_6m",
      targetBillingCycle: "yearly",
    })).toBe("immediate_annual_conversion");
  });

  it("keeps retired monthly subscriptions scheduled into prepaid packages", () => {
    expect(classifySubscriptionChange({
      currentPlanCode: "plus",
      currentBillingCycle: "monthly",
      targetPlanCode: "expert_12m",
      targetBillingCycle: "yearly",
    })).toBe("scheduled");
  });
});

describe("subscription proration", () => {
  it("adds the unconsumed base time to the full upgraded allowance", () => {
    expect(monthlyUpgradeBaseGrantSeconds({
      targetPlanSeconds: 200 * 60,
      currentBaseUnconsumedSeconds: 70 * 60,
    })).toBe(270 * 60);
  });

  it.each([
    ["plus", plus, "standard", standard, 19_900, 9_900],
    ["plus", plus, "pro", pro, 49_900, 9_900],
    ["standard", standard, "pro", pro, 49_900, 19_900],
  ] as const)(
    "charges the full %s-to-%s monthly price and separately refunds the same-day payment",
    (
      currentPlanCode,
      currentPlan,
      targetPlanCode,
      targetPlan,
      approvedAmount,
      refundAmount,
    ) => {
      const quote = quoteSubscriptionChange({
        currentPlanCode,
        currentBillingCycle: "monthly",
        currentPlan,
        targetPlanCode,
        targetBillingCycle: "monthly",
        targetPlan,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        now,
        monthlyPeriodEnd,
        annualPeriodEnd,
        sourcePaymentAmountKrw: refundAmount,
        sourcePaymentApprovedAt: now,
      });
      expect(quote.chargeAmountKrw).toBe(approvedAmount);
      expect(quote.providerChargeAmountKrw).toBe(approvedAmount);
      expect(quote.prorationCreditKrw).toBe(refundAmount);
      expect(quote.fullCurrentPaymentRefund).toBe(true);
      expect(quote.refundMode).toBe("automatic_full");
      expect(quote.effectiveAt).toEqual(now);
      expect(quote.nextChargeAt).toEqual(monthlyPeriodEnd);
    },
  );

  it("charges the full annual price and queues the unused monthly value for refund", () => {
    const quote = quoteSubscriptionChange({
      currentPlanCode: "plus",
      currentBillingCycle: "monthly",
      currentPlan: plus,
      targetPlanCode: "standard",
      targetBillingCycle: "yearly",
      targetPlan: standard,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      now,
      monthlyPeriodEnd,
      annualPeriodEnd,
      sourcePaymentAmountKrw: 9_900,
      sourcePaymentApprovedAt: periodStart,
    });
    expect(quote.chargeAmountKrw).toBe(191_040);
    expect(quote.providerChargeAmountKrw).toBe(191_040);
    expect(quote.prorationCreditKrw).toBe(4_620);
    expect(quote.fullCurrentPaymentRefund).toBe(false);
    expect(quote.refundMode).toBe("manual_partial");
    expect(quote.nextChargeAt).toEqual(annualPeriodEnd);
  });

  it("charges the package price and fully refunds Easycut Pro regardless of elapsed days", () => {
    const quote = quoteSubscriptionChange({
      currentPlanCode: "easycut_pro_v2",
      currentBillingCycle: "monthly",
      currentPlan: { monthlyPriceKrw: 9_900, yearlyPriceKrw: 0 },
      targetPlanCode: "starter_6m",
      targetBillingCycle: "yearly",
      targetPlan: { monthlyPriceKrw: 19_900, yearlyPriceKrw: 119_400 },
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      now,
      monthlyPeriodEnd,
      annualPeriodEnd,
      sourcePaymentAmountKrw: 9_900,
      sourcePaymentApprovedAt: periodStart,
    });

    expect(quote.action).toBe("immediate_annual_conversion");
    expect(quote.chargeAmountKrw).toBe(119_400);
    expect(quote.providerChargeAmountKrw).toBe(119_400);
    expect(quote.prorationCreditKrw).toBe(9_900);
    expect(quote.fullCurrentPaymentRefund).toBe(true);
    expect(quote.refundMode).toBe("automatic_full");
    expect(quote.refundAmountKrw).toBe(9_900);
    expect(quote.startsNewBillingPeriod).toBe(true);
    expect(quote.nextChargeAt).toEqual(annualPeriodEnd);
  });

  it("keeps annual upgrades on the original renewal date", () => {
    const quote = quoteSubscriptionChange({
      currentPlanCode: "standard",
      currentBillingCycle: "yearly",
      currentPlan: standard,
      targetPlanCode: "pro",
      targetBillingCycle: "yearly",
      targetPlan: pro,
      currentPeriodStart: new Date("2026-01-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2027-01-01T00:00:00.000Z"),
      now: new Date("2026-07-02T12:00:00.000Z"),
      monthlyPeriodEnd,
      annualPeriodEnd,
    });
    expect(quote.action).toBe("immediate_proration");
    expect(quote.providerChargeAmountKrw).toBe(quote.chargeAmountKrw);
    expect(quote.fullCurrentPaymentRefund).toBe(false);
    expect(quote.nextChargeAt).toEqual(new Date("2027-01-01T00:00:00.000Z"));
  });
});

describe("monthly upgrade refund calendar", () => {
  const leapStart = new Date("2028-01-31T15:00:00.000Z"); // 2028-02-01 00:00 KST
  const leapEnd = new Date("2028-02-29T15:00:00.000Z"); // 2028-03-01 00:00 KST

  it("uses the full amount when payment and upgrade occur on the same KST day", () => {
    expect(quoteMonthlyUpgradeRefund({
      sourcePaymentAmountKrw: 19_900,
      sourcePaymentApprovedAt: new Date("2028-02-01T14:59:59.000Z"),
      currentPeriodStart: leapStart,
      currentPeriodEnd: leapEnd,
      now: new Date("2028-02-01T00:00:00.000Z"),
    })).toEqual({
      mode: "automatic_full",
      amountKrw: 19_900,
      totalPeriodDays: 29,
      unusedPeriodDays: 29,
    });
  });

  it("counts the upgrade day as used from the next KST day onward", () => {
    expect(quoteMonthlyUpgradeRefund({
      sourcePaymentAmountKrw: 19_900,
      sourcePaymentApprovedAt: new Date("2028-01-31T15:00:00.000Z"),
      currentPeriodStart: leapStart,
      currentPeriodEnd: leapEnd,
      now: new Date("2028-02-01T15:00:00.000Z"),
    })).toEqual({
      mode: "manual_partial",
      amountKrw: Math.floor(19_900 * 27 / 29),
      totalPeriodDays: 29,
      unusedPeriodDays: 27,
    });
  });

  it("does not create a queue when upgrading on the last KST day", () => {
    expect(quoteMonthlyUpgradeRefund({
      sourcePaymentAmountKrw: 19_900,
      sourcePaymentApprovedAt: leapStart,
      currentPeriodStart: leapStart,
      currentPeriodEnd: leapEnd,
      now: new Date("2028-02-29T00:00:00.000Z"),
    })).toEqual({
      mode: "none",
      amountKrw: 0,
      totalPeriodDays: 29,
      unusedPeriodDays: 0,
    });
  });

  it("changes days exactly at KST midnight", () => {
    const beforeMidnight = quoteMonthlyUpgradeRefund({
      sourcePaymentAmountKrw: 9_900,
      sourcePaymentApprovedAt: new Date("2026-07-01T01:00:00.000Z"),
      currentPeriodStart: new Date("2026-06-30T15:00:00.000Z"),
      currentPeriodEnd: new Date("2026-07-31T15:00:00.000Z"),
      now: new Date("2026-07-01T14:59:59.999Z"),
    });
    const atMidnight = quoteMonthlyUpgradeRefund({
      sourcePaymentAmountKrw: 9_900,
      sourcePaymentApprovedAt: new Date("2026-07-01T01:00:00.000Z"),
      currentPeriodStart: new Date("2026-06-30T15:00:00.000Z"),
      currentPeriodEnd: new Date("2026-07-31T15:00:00.000Z"),
      now: new Date("2026-07-01T15:00:00.000Z"),
    });
    expect(beforeMidnight.mode).toBe("automatic_full");
    expect(atMidnight.mode).toBe("manual_partial");
  });
});
