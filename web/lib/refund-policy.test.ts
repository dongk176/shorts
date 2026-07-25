import { describe, expect, it } from "vitest";
import { quoteCustomerEarlyTerminationRefund } from "./refund-policy";

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
