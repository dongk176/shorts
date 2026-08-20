import { afterEach, describe, expect, it, vi } from "vitest";
import {
  tossBillingCheckoutKeys,
  tossBillingClientKey,
  tossBillingSecretKey,
} from "./toss-billing-config";

describe("toss billing configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function enableBilling() {
    vi.stubEnv("TOSS_BILLING_ENABLED", "true");
    vi.stubEnv("TOSS_BILLING_CHARGES_ENABLED", "true");
  }

  it("prefers the dedicated billing keys", () => {
    enableBilling();
    vi.stubEnv("NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY", "billing-client");
    vi.stubEnv("NEXT_PUBLIC_TOSS_CLIENT_KEY", "legacy-client");
    vi.stubEnv("TOSS_BILLING_SECRET_KEY", "billing-secret");
    vi.stubEnv("TOSS_SECRET_KEY", "legacy-secret");

    expect(tossBillingClientKey()).toBe("billing-client");
    expect(tossBillingSecretKey()).toBe("billing-secret");
  });

  it("accepts the already deployed legacy key names", () => {
    enableBilling();
    vi.stubEnv("NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY", "");
    vi.stubEnv("TOSS_BILLING_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_TOSS_CLIENT_KEY", "legacy-client");
    vi.stubEnv("TOSS_SECRET_KEY", "legacy-secret");

    expect(tossBillingClientKey()).toBe("legacy-client");
    expect(tossBillingSecretKey()).toBe("legacy-secret");
  });

  it("accepts an individual billing API key pair", () => {
    enableBilling();
    vi.stubEnv("NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY", "live_ck_example");
    vi.stubEnv("TOSS_BILLING_SECRET_KEY", "live_sk_example");

    expect(tossBillingCheckoutKeys()).toEqual({
      clientKey: "live_ck_example",
      secretKey: "live_sk_example",
    });
  });

  it("rejects a general payment widget key for billing", () => {
    enableBilling();
    vi.stubEnv("NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY", "live_gck_example");
    vi.stubEnv("TOSS_BILLING_SECRET_KEY", "live_gsk_example");

    expect(() => tossBillingCheckoutKeys()).toThrow("API 개별 연동 키");
  });
});
