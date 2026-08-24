import { describe, expect, it } from "vitest";
import {
  getPrepaidPackageMonthState,
  quoteCustomerEarlyTerminationRefund,
  quotePrepaidPackageRefund,
} from "./refund-policy";

describe("prepaid package monthly-unit refund policy", () => {
  const periodStart = new Date("2026-07-25T03:00:00.000Z");

  it("charges one contract month when the current monthly allowance was used", () => {
    const quote = quotePrepaidPackageRefund({
      actualPaymentKrw: 119_400,
      periodStart,
      prepaidMonths: 6,
      currentMonthUsed: true,
      requestedAt: new Date("2026-07-26T03:00:00.000Z"),
    });

    expect(quote.monthlyUnitKrw).toBe(19_900);
    expect(quote.chargedMonths).toBe(1);
    expect(quote.providedServiceKrw).toBe(19_900);
    expect(quote.refundAmountKrw).toBe(99_500);
    expect(quote.entitlementEndsAt.toISOString()).toBe("2026-08-25T03:00:00.000Z");
  });

  it("refunds the current and future monthly units when the current unit was not used", () => {
    const requestedAt = new Date("2026-07-26T03:00:00.000Z");
    const quote = quotePrepaidPackageRefund({
      actualPaymentKrw: 119_400,
      periodStart,
      prepaidMonths: 6,
      currentMonthUsed: false,
      requestedAt,
    });

    expect(quote.chargedMonths).toBe(0);
    expect(quote.refundAmountKrw).toBe(119_400);
    expect(quote.entitlementEndsAt).toEqual(requestedAt);
  });

  it("keeps completed monthly units and the used current unit", () => {
    const quote = quotePrepaidPackageRefund({
      actualPaymentKrw: 119_400,
      periodStart,
      prepaidMonths: 6,
      currentMonthUsed: true,
      requestedAt: new Date("2026-08-30T03:00:00.000Z"),
    });

    expect(quote.completedMonths).toBe(1);
    expect(quote.currentMonthNumber).toBe(2);
    expect(quote.chargedMonths).toBe(2);
    expect(quote.providedServiceKrw).toBe(39_800);
    expect(quote.refundAmountKrw).toBe(79_600);
    expect(quote.entitlementEndsAt.toISOString()).toBe("2026-09-25T03:00:00.000Z");
  });

  it("handles KST month-end anchors without spilling into the following month", () => {
    const state = getPrepaidPackageMonthState({
      periodStart: new Date("2026-01-31T01:00:00.000Z"),
      prepaidMonths: 3,
      requestedAt: new Date("2026-02-28T01:00:00.000Z"),
    });

    expect(state.completedMonths).toBe(1);
    expect(state.currentMonthStart?.toISOString()).toBe("2026-02-28T01:00:00.000Z");
    expect(state.currentMonthEnd?.toISOString()).toBe("2026-03-31T01:00:00.000Z");
  });
});

describe("customer early-termination refund policy", () => {
  const periodStart = new Date("2026-01-01T00:00:00.000Z");
  const periodEnd = new Date("2027-01-01T00:00:00.000Z");

  it("deducts elapsed access value and 10% of the remaining-period value", () => {
    const quote = quoteCustomerEarlyTerminationRefund({
      actualPaymentKrw: 432_000,
      periodStart,
      periodEnd,
      requestedAt: new Date("2026-02-15T00:00:00.000Z"),
    });

    expect(quote.elapsedServiceKrw).toBe(53_260);
    expect(quote.remainingServiceKrw).toBe(378_740);
    expect(quote.penaltyKrw).toBe(37_874);
    expect(quote.refundAmountKrw).toBe(340_866);
  });

  it("does not charge the penalty during the first seven days", () => {
    const quote = quoteCustomerEarlyTerminationRefund({
      actualPaymentKrw: 432_000,
      periodStart,
      periodEnd,
      requestedAt: new Date("2026-01-06T00:00:00.000Z"),
    });

    expect(quote.withinSevenDays).toBe(true);
    expect(quote.penaltyKrw).toBe(0);
    expect(quote.refundAmountKrw).toBe(426_083);
  });

  it("subtracts refunds already completed or reserved from the policy total", () => {
    const quote = quoteCustomerEarlyTerminationRefund({
      actualPaymentKrw: 432_000,
      refundedOrReservedKrw: 40_000,
      periodStart,
      periodEnd,
      requestedAt: new Date("2026-02-15T00:00:00.000Z"),
    });

    expect(quote.policyRefundTotalKrw).toBe(340_866);
    expect(quote.refundAmountKrw).toBe(300_866);
  });

  it("returns no refund after the contract period has elapsed", () => {
    const quote = quoteCustomerEarlyTerminationRefund({
      actualPaymentKrw: 432_000,
      periodStart,
      periodEnd,
      requestedAt: new Date("2027-02-01T00:00:00.000Z"),
    });

    expect(quote.elapsedServiceKrw).toBe(432_000);
    expect(quote.refundAmountKrw).toBe(0);
  });
});
