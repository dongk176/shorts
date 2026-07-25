import { describe, expect, it } from "vitest";
import {
  planAdminSubscriptionPeriod,
  planAdminSubscriptionProviderTransition,
} from "./admin-subscription";

describe("administrator subscription provider transitions", () => {
  it("enables a usable monthly ThePayOne schedule for active status", () => {
    expect(planAdminSubscriptionProviderTransition({
      targetStatus: "active",
      billingCycle: "monthly",
      paymentProvider: "thepayone",
      providerScheduleStatus: "paused",
      hasUsableThePayOneMethod: true,
    })).toEqual({
      action: "enable",
      scheduleStatus: "active",
      requiresReview: false,
      reviewReason: null,
    });
  });

  it("pauses a usable monthly schedule for every inactive status", () => {
    for (const targetStatus of ["past_due", "canceled", "expired"] as const) {
      expect(planAdminSubscriptionProviderTransition({
        targetStatus,
        billingCycle: "monthly",
        paymentProvider: "thepayone",
        providerScheduleStatus: "active",
        hasUsableThePayOneMethod: true,
      })).toMatchObject({
        action: "pause",
        scheduleStatus: "paused",
        requiresReview: false,
      });
    }
  });

  it("marks an unmanageable monthly schedule for review without hiding the state change", () => {
    expect(planAdminSubscriptionProviderTransition({
      targetStatus: "active",
      billingCycle: "monthly",
      paymentProvider: "thepayone",
      providerScheduleStatus: "manual_review",
      hasUsableThePayOneMethod: false,
    })).toEqual({
      action: "none",
      scheduleStatus: "manual_review",
      requiresReview: true,
      reviewReason: "ADMIN_PAYMENT_SCHEDULE_UNAVAILABLE",
    });
  });

  it("does not touch a provider schedule for an annual subscription", () => {
    expect(planAdminSubscriptionProviderTransition({
      targetStatus: "active",
      billingCycle: "yearly",
      paymentProvider: "thepayone",
      providerScheduleStatus: "none",
      hasUsableThePayOneMethod: true,
    })).toEqual({
      action: "none",
      scheduleStatus: "none",
      requiresReview: false,
      reviewReason: null,
    });
  });
});

describe("administrator subscription period transitions", () => {
  const now = new Date("2026-07-23T03:00:00.000Z");

  it("preserves a paid period that is still current", () => {
    const start = new Date("2026-07-01T00:00:00.000Z");
    const end = new Date("2026-08-01T00:00:00.000Z");
    expect(planAdminSubscriptionPeriod({
      targetStatus: "active",
      billingCycle: "monthly",
      currentPeriodStart: start,
      currentPeriodEnd: end,
      billingAnchorDay: 1,
      now,
    })).toEqual({
      periodStart: start,
      periodEnd: end,
      nextChargeAt: end,
      periodReset: false,
    });
  });

  it("starts a new provider-aligned monthly period when the old period ended", () => {
    const result = planAdminSubscriptionPeriod({
      targetStatus: "active",
      billingCycle: "monthly",
      currentPeriodStart: new Date("2026-06-05T03:00:00.000Z"),
      currentPeriodEnd: new Date("2026-07-05T03:00:00.000Z"),
      billingAnchorDay: 5,
      now,
    });
    expect(result.periodStart).toEqual(now);
    expect(result.periodEnd).toEqual(new Date("2026-08-05T03:00:00.000Z"));
    expect(result.nextChargeAt).toEqual(result.periodEnd);
    expect(result.periodReset).toBe(true);
  });

  it("clears the next charge for inactive states", () => {
    expect(planAdminSubscriptionPeriod({
      targetStatus: "canceled",
      billingCycle: "monthly",
      currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      billingAnchorDay: 1,
      now,
    })).toMatchObject({
      nextChargeAt: null,
      periodReset: false,
    });
  });
});
