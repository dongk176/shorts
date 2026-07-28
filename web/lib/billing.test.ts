import { describe, expect, it } from "vitest";
import {
  addKstMonths,
  assertPricingV2PackagePurchaseAvailable,
  createBaseUsageGrant,
  createBillingOrderId,
  extendMonthlyEntitlement,
  getBillingSummary,
  nextMonthlyChargeAfterResume,
  type BillingDb,
  type PaidPlanProduct,
} from "./billing";

const packagePlan: PaidPlanProduct = {
  code: "starter_3m",
  displayName: "스타터 패키지 3개월",
  monthlySourceSeconds: 12_000,
  retentionDays: 30,
  monthlyPriceKrw: 23_000,
  yearlyPriceKrw: 69_000,
  maxActiveJobs: 2,
  prepaidMonths: 3,
};

describe("billing periods", () => {
  it("clamps a KST month-end anniversary without changing local time", () => {
    const start = new Date("2026-01-31T03:30:00.000Z"); // Jan 31 12:30 KST
    expect(addKstMonths(start, 1).toISOString()).toBe("2026-02-28T03:30:00.000Z");
  });

  it("preserves the original billing anchor after a short month", () => {
    const februaryEnd = new Date("2026-02-27T15:00:00.000Z");
    expect(addKstMonths(februaryEnd, 1, 31).toISOString()).toBe("2026-03-30T15:00:00.000Z");
  });

  it("aligns a late-month signup to ThePayOne's supported day 28 anchor", () => {
    const julyEnd = new Date("2026-07-31T03:30:00.000Z");
    expect(addKstMonths(julyEnd, 1, 28).toISOString()).toBe("2026-08-28T03:30:00.000Z");
  });

  it("adds a paid month after the remaining entitlement tail", () => {
    const paidAt = new Date("2026-07-25T03:00:00.000Z");
    const remainingTail = new Date("2026-08-10T03:00:00.000Z");
    expect(extendMonthlyEntitlement(remainingTail, paidAt, 10).toISOString())
      .toBe("2026-09-10T03:00:00.000Z");
  });

  it("starts a fresh paid month from approval when the old entitlement ended", () => {
    const paidAt = new Date("2026-07-25T03:00:00.000Z");
    const expiredTail = new Date("2026-07-20T03:00:00.000Z");
    expect(extendMonthlyEntitlement(expiredTail, paidAt).toISOString())
      .toBe("2026-08-25T03:00:00.000Z");
  });

  it("keeps the original future automatic billing date when paid months stack", () => {
    const scheduled = new Date("2026-08-25T03:00:00.000Z");
    const resumedAt = new Date("2026-07-26T03:00:00.000Z");
    expect(nextMonthlyChargeAfterResume(scheduled, resumedAt, 25).toISOString())
      .toBe(scheduled.toISOString());
  });

  it("rolls a missed automatic billing date to the next valid KST month", () => {
    const missed = new Date("2026-08-25T03:00:00.000Z");
    const resumedAt = new Date("2026-09-01T03:00:00.000Z");
    expect(nextMonthlyChargeAfterResume(missed, resumedAt, 25).toISOString())
      .toBe("2026-09-25T03:00:00.000Z");
  });

  it("creates payment-provider-safe unique order identifiers", () => {
    const orderId = createBillingOrderId("SUB");
    expect(orderId).toMatch(/^EC-SUB-[a-f0-9]{32}$/);
    expect(orderId.length).toBeLessThanOrEqual(64);
  });

  it("schedules the next package grant monthly while keeping unused time until package end", async () => {
    const statements: unknown[][] = [];
    const db = (async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      statements.push(values);
      return [];
    }) as unknown as BillingDb;
    const validFrom = new Date("2026-07-25T03:00:00.000Z");
    const subscriptionEnd = new Date("2026-10-25T03:00:00.000Z");

    const nextQuotaAt = await createBaseUsageGrant({
      db,
      userId: "user",
      subscriptionId: "subscription",
      billingOrderId: "order",
      plan: packagePlan,
      validFrom,
      subscriptionEnd,
      carryUntilSubscriptionEnd: true,
    });

    expect(nextQuotaAt.toISOString()).toBe("2026-08-25T03:00:00.000Z");
    expect((statements[0].at(-1) as Date).toISOString()).toBe(subscriptionEnd.toISOString());
  });
});

describe("billing summary", () => {
  it("shows the account default card even when there is no active product", async () => {
    const paidAt = new Date("2026-07-25T03:00:00.000Z");
    const responses = [
      [{
        hasPaymentHistory: true,
        purchasedPackageCodes: [],
        productCode: "starter_3m",
        billingCycle: "yearly",
        approvedAt: paidAt,
        defaultPaymentProvider: "thepayone",
        defaultIssuerName: "현대카드",
        defaultIssuerCode: null,
        defaultCardNumberMasked: "123456******9876",
        defaultCardLast4: "9876",
        defaultHasStoredPayerTel: true,
      }],
      [],
    ];
    const db = (async () => responses.shift() || []) as unknown as BillingDb;

    const summary = await getBillingSummary(db, "user-a");

    expect(summary).toMatchObject({
      status: "none",
      cardIssuer: "현대카드",
      cardNumberMasked: "123456******9876",
      cardLast4: "9876",
      hasStoredPayerTel: true,
      paymentProvider: "thepayone",
    });
  });

  it("allows complimentary processing without inventing an active paid product", async () => {
    const responses = [
      [{
        hasPaymentHistory: false,
        purchasedPackageCodes: [],
        hasManualServiceAccess: true,
      }],
      [],
    ];
    const db = (async () => responses.shift() || []) as unknown as BillingDb;

    const summary = await getBillingSummary(db, "user-direct");

    expect(summary).toMatchObject({
      status: "none",
      planCode: "free",
      activeProducts: [],
      canCreateJobs: true,
      maxActiveJobs: 1,
      retentionDays: 30,
    });
  });

  it("allows only one active job with one-day retention for a free welcome grant", async () => {
    const responses = [
      [{
        hasPaymentHistory: false,
        purchasedPackageCodes: [],
        hasManualServiceAccess: false,
        hasOnboardingWelcomeAccess: true,
      }],
      [],
    ];
    const db = (async () => responses.shift() || []) as unknown as BillingDb;

    const summary = await getBillingSummary(db, "user-welcome");

    expect(summary).toMatchObject({
      status: "none",
      planCode: "free",
      activeProducts: [],
      canCreateJobs: true,
      maxActiveJobs: 1,
      retentionDays: 1,
    });
  });

  it("returns every currently active product and excludes overdue products", async () => {
    const activeStart = new Date("2026-01-01T00:00:00.000Z");
    const activeEnd = new Date("2099-01-01T00:00:00.000Z");
    const responses = [
      [{
        hasPaymentHistory: true,
        purchasedPackageCodes: ["starter_3m"],
        productCode: "starter_3m",
        billingCycle: "yearly",
        approvedAt: activeStart,
        defaultPaymentProvider: "thepayone",
        defaultIssuerName: "현대카드",
        defaultIssuerCode: null,
        defaultCardNumberMasked: "654321******5678",
        defaultCardLast4: "5678",
        defaultHasStoredPayerTel: true,
      }],
      [
        {
          status: "active",
          planCode: "starter_3m",
          displayName: "스타터 패키지 3개월",
          billingCycle: "yearly",
          currentPeriodStart: activeStart,
          currentPeriodEnd: activeEnd,
          nextChargeAt: null,
          cancelAtPeriodEnd: false,
          scheduledPlanCode: null,
          scheduledBillingCycle: null,
          paymentProvider: "thepayone",
          providerScheduleStatus: "none",
          billingReviewStatus: "none",
          issuerName: "테스트카드",
          issuerCode: null,
          cardNumberMasked: "12345678****1234",
          cardLast4: "1234",
          hasStoredPayerTel: true,
          monthlySourceSeconds: 12_000,
          maxActiveJobs: 2,
          retentionDays: 30,
        },
        {
          status: "past_due",
          planCode: "easycut_pro_v2",
          displayName: "이지컷 프로",
          billingCycle: "monthly",
          currentPeriodStart: activeStart,
          currentPeriodEnd: activeEnd,
          nextChargeAt: null,
          cancelAtPeriodEnd: false,
          monthlySourceSeconds: 3_600,
          maxActiveJobs: 1,
          retentionDays: 30,
        },
      ],
    ];
    const db = (async () => responses.shift() || []) as unknown as BillingDb;

    const summary = await getBillingSummary(db, "user-a");

    expect(summary.activeProducts).toEqual([{
      planCode: "starter_3m",
      displayName: "스타터 패키지 3개월",
      billingCycle: "yearly",
      currentPeriodStart: activeStart.toISOString(),
      currentPeriodEnd: activeEnd.toISOString(),
      nextChargeAt: null,
      cancelAtPeriodEnd: false,
      monthlySourceSeconds: 12_000,
    }]);
    expect(summary.purchasedPackageCodes).toEqual(["starter_3m"]);
    expect(summary.cardIssuer).toBe("현대카드");
    expect(summary.cardLast4).toBe("5678");
  });
});

describe("one-time package purchase guard", () => {
  it("allows a package product with no previous blocking order", async () => {
    const db = (async () => []) as unknown as BillingDb;
    await expect(assertPricingV2PackagePurchaseAvailable(
      db,
      "user-a",
      "starter_3m",
    )).resolves.toBeUndefined();
  });

  it("blocks a package product that already has a purchase order", async () => {
    const db = (async () => [{ id: "existing-order" }]) as unknown as BillingDb;
    await expect(assertPricingV2PackagePurchaseAvailable(
      db,
      "user-a",
      "starter_3m",
    )).rejects.toMatchObject({
      status: 409,
      code: "PACKAGE_ALREADY_PURCHASED",
    });
  });
});
