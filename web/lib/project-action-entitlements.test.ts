import { describe, expect, it } from "vitest";
import {
  assertPaidProjectActionAccess,
  billingSupportsPaidProjectActions,
  paidProjectActionMessages,
} from "./project-action-entitlements";

describe("paid project action entitlements", () => {
  it("allows an active paid product", () => {
    const billing = {
      activeProducts: [{
        planCode: "plus" as const,
        displayName: "Plus",
        billingCycle: "monthly" as const,
        currentPeriodStart: "2026-07-01T00:00:00.000Z",
        currentPeriodEnd: "2026-08-01T00:00:00.000Z",
        nextChargeAt: "2026-08-01T00:00:00.000Z",
        cancelAtPeriodEnd: false,
        monthlySourceSeconds: 6000,
      }],
    };

    expect(billingSupportsPaidProjectActions(billing)).toBe(true);
    expect(() => assertPaidProjectActionAccess(billing, "edit")).not.toThrow();
  });

  it.each([
    ["edit", paidProjectActionMessages.edit],
    ["download", paidProjectActionMessages.download],
  ] as const)("blocks free access to %s", (action, message) => {
    expect(billingSupportsPaidProjectActions({ activeProducts: [] })).toBe(false);
    expect(() => assertPaidProjectActionAccess({ activeProducts: [] }, action))
      .toThrow(message);
  });
});
