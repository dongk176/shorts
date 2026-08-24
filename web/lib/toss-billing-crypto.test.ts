import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptTossBillingKey,
  encryptTossBillingKey,
  tossBillingKeyContext,
  tossBillingKeyHash,
} from "@/lib/toss-billing-crypto";

describe("Toss billing key encryption", () => {
  beforeEach(() => {
    process.env.TOSS_BILLING_KEY_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });
  afterEach(() => delete process.env.TOSS_BILLING_KEY_ENCRYPTION_KEY);

  it("round trips only with the same user and payment method context", () => {
    const context = tossBillingKeyContext("user-a", "method-a");
    const encrypted = encryptTossBillingKey("billing-key-secret", context);
    expect(decryptTossBillingKey(encrypted, context)).toBe("billing-key-secret");
    expect(() => decryptTossBillingKey(
      encrypted,
      tossBillingKeyContext("user-b", "method-a"),
    )).toThrow();
  });

  it("stores only an irreversible hash for lookup and audit", () => {
    expect(tossBillingKeyHash("billing-key-secret")).toMatch(/^[a-f0-9]{64}$/);
    expect(tossBillingKeyHash("billing-key-secret")).not.toContain("billing-key-secret");
  });
});
