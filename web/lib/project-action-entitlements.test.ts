import { describe, expect, it } from "vitest";
import {
  assertProjectActionAccess,
  assertPaidProjectActionAccess,
  billingSupportsPaidProjectActions,
  paidProjectActionMessages,
  userSupportsProjectActions,
} from "./project-action-entitlements";

function fakeDb(rows: Array<Record<string, unknown>>) {
  return (() => Promise.resolve(rows)) as never;
}

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

  it("allows an active administrator-issued account without a paid product", async () => {
    const billing = { activeProducts: [] };
    const db = fakeDb([{ allowed: true }]);

    await expect(userSupportsProjectActions(db, billing, "managed-user"))
      .resolves.toBe(true);
    await expect(assertProjectActionAccess(db, billing, "managed-user", "download"))
      .resolves.toBeUndefined();
  });

  it("keeps ordinary free and disabled administrator-issued accounts blocked", async () => {
    const billing = { activeProducts: [] };
    const db = fakeDb([{ allowed: false }]);

    await expect(userSupportsProjectActions(db, billing, "free-user"))
      .resolves.toBe(false);
    await expect(assertProjectActionAccess(db, billing, "free-user", "edit"))
      .rejects.toThrow(paidProjectActionMessages.edit);
  });

  it("does not query managed accounts when an active paid product already grants access", async () => {
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
    const db = (() => {
      throw new Error("managed lookup must not run");
    }) as never;

    await expect(userSupportsProjectActions(db, billing, "paid-user"))
      .resolves.toBe(true);
  });
});
