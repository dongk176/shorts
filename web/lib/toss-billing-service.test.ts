import { describe, expect, it } from "vitest";
import { canRetireFailedTossInitialAttempt } from "@/lib/toss-billing-service";

describe("failed Toss initial purchase retirement", () => {
  it("retires only a conclusively failed pending initial purchase", () => {
    expect(canRetireFailedTossInitialAttempt({
      subscriptionStatus: "pending",
      orderKind: "subscription_initial",
      orderStatus: "failed",
      ledgerStatuses: ["failed"],
      fulfillmentStatuses: ["pending"],
    })).toBe(true);
  });

  it.each([
    { ledgerStatuses: [], fulfillmentStatuses: [] },
    { ledgerStatuses: ["unknown"], fulfillmentStatuses: ["pending"] },
    { ledgerStatuses: ["processing"], fulfillmentStatuses: ["pending"] },
    { ledgerStatuses: ["succeeded"], fulfillmentStatuses: ["applied"] },
  ])("keeps ambiguous or fulfilled attempts locked", (override) => {
    expect(canRetireFailedTossInitialAttempt({
      subscriptionStatus: "pending",
      orderKind: "subscription_initial",
      orderStatus: "failed",
      ledgerStatuses: override.ledgerStatuses,
      fulfillmentStatuses: override.fulfillmentStatuses,
    })).toBe(false);
  });
});
