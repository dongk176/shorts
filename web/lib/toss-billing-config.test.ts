import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
});
