import { describe, expect, it } from "vitest";
import type { BillingDb } from "@/lib/billing";
import {
  getDefaultPaymentMethodId,
  setDefaultPaymentMethod,
} from "@/lib/default-payment-method";

describe("account default payment method", () => {
  it("returns the usable account default method", async () => {
    const db = (async () => [{ id: "method-latest" }]) as unknown as BillingDb;

    await expect(getDefaultPaymentMethodId(db, "user-a"))
      .resolves.toBe("method-latest");
  });

  it("rejects a method that is not owned by the account", async () => {
    const db = (async () => []) as unknown as BillingDb;

    await expect(setDefaultPaymentMethod(db, "user-a", "method-b"))
      .rejects.toMatchObject({
        status: 409,
        code: "PAYMENT_METHOD_OWNERSHIP_MISMATCH",
      });
  });
});
