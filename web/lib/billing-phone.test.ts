import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptBillingPhone,
  encryptBillingPhone,
  isBillingPhone,
  normalizeBillingPhone,
} from "./billing-phone";

describe("billing phone encryption", () => {
  beforeEach(() => {
    vi.stubEnv("THEPAYONE_PAY_KEY", "pay-key");
    vi.stubEnv("THEPAYONE_CARD_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normalizes and encrypts a payer phone with payment-method-bound AAD", () => {
    const methodId = "b8e310fc-364d-4293-97b7-944f2f49ff78";
    const encrypted = encryptBillingPhone("010-1234-5678", methodId);
    expect(encrypted.ciphertext).not.toContain("01012345678");
    expect(decryptBillingPhone(encrypted, methodId)).toBe("01012345678");
    expect(() => decryptBillingPhone(encrypted, "another-method")).toThrow();
  });

  it("rejects malformed phone values", () => {
    expect(normalizeBillingPhone("010-1234-5678")).toBe("01012345678");
    expect(isBillingPhone("01012345678")).toBe(true);
    expect(isBillingPhone("123")).toBe(false);
    expect(() => encryptBillingPhone("123", "method")).toThrow("형식");
  });
});
