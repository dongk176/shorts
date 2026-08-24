import { beforeEach, describe, expect, it } from "vitest";
import {
  createReferralPasswordHash,
  decryptReferralAccountNumber,
  encryptReferralAccountNumber,
  verifyReferralPassword,
} from "@/lib/referral-security";

describe("referral security", () => {
  beforeEach(() => {
    process.env.REFERRAL_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("hashes and verifies partner passwords without storing plaintext", async () => {
    const stored = await createReferralPasswordHash("safe-password-123");
    expect(stored.hash).not.toContain("safe-password-123");
    expect(await verifyReferralPassword("safe-password-123", stored.hash, stored.salt)).toBe(true);
    expect(await verifyReferralPassword("wrong-password", stored.hash, stored.salt)).toBe(false);
  });

  it("encrypts account numbers with a partner-bound context", () => {
    const encrypted = encryptReferralAccountNumber("110-123-456789", "partner-a");
    expect(encrypted.ciphertext).not.toContain("110123456789");
    expect(encrypted.last4).toBe("6789");
    expect(decryptReferralAccountNumber(encrypted, "partner-a")).toBe("110123456789");
    expect(() => decryptReferralAccountNumber(encrypted, "partner-b")).toThrow();
  });
});
