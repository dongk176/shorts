import { afterEach, describe, expect, it, vi } from "vitest";
import {
  oneTimePaymentMode,
  resolveOneTimePaymentFlow,
} from "./manual-payment-routing";

function fakeDb(enabled: boolean) {
  return (() => Promise.resolve([{ enabled }])) as never;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("manual one-time payment routing", () => {
  it("defaults package and add-on purchases to legacy", async () => {
    expect(oneTimePaymentMode("package")).toBe("legacy");
    expect(oneTimePaymentMode("addon")).toBe("legacy");
    await expect(resolveOneTimePaymentFlow(fakeDb(true), "package"))
      .resolves.toBe("legacy");
  });

  it("requires both the credential gate and runtime flag for manual payment", async () => {
    vi.stubEnv("THEPAYONE_PACKAGE_PAYMENT_MODE", "manual");
    vi.stubEnv("THEPAYONE_PACKAGE_BILLING_ENABLED", "false");
    await expect(resolveOneTimePaymentFlow(fakeDb(true), "package"))
      .resolves.toBe("disabled");

    vi.stubEnv("THEPAYONE_PACKAGE_BILLING_ENABLED", "true");
    await expect(resolveOneTimePaymentFlow(fakeDb(false), "package"))
      .resolves.toBe("disabled");
    await expect(resolveOneTimePaymentFlow(fakeDb(true), "package"))
      .resolves.toBe("manual_direct");
  });

  it("routes add-ons independently from package mode", async () => {
    vi.stubEnv("THEPAYONE_PACKAGE_PAYMENT_MODE", "legacy");
    vi.stubEnv("THEPAYONE_ADDON_PAYMENT_MODE", "manual");
    vi.stubEnv("THEPAYONE_PACKAGE_BILLING_ENABLED", "true");
    await expect(resolveOneTimePaymentFlow(fakeDb(true), "package"))
      .resolves.toBe("legacy");
    await expect(resolveOneTimePaymentFlow(fakeDb(true), "addon"))
      .resolves.toBe("manual_direct");
  });

  it("never falls back to legacy when a selected manual flow is switched off", async () => {
    vi.stubEnv("THEPAYONE_PACKAGE_PAYMENT_MODE", "manual");
    vi.stubEnv("THEPAYONE_ADDON_PAYMENT_MODE", "disabled");
    vi.stubEnv("THEPAYONE_PACKAGE_BILLING_ENABLED", "true");
    await expect(resolveOneTimePaymentFlow(fakeDb(false), "package"))
      .resolves.toBe("disabled");
    await expect(resolveOneTimePaymentFlow(fakeDb(true), "addon"))
      .resolves.toBe("disabled");
  });

  it("never lets local-only environment flags bypass the shared runtime flag", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PAYMENT_TEST_MODE", "true");
    vi.stubEnv("PAYMENT_TESTER_EMAILS", "tester@example.com");
    vi.stubEnv("THEPAYONE_LOCAL_MANUAL_CHECKOUT_ENABLED", "true");
    vi.stubEnv("THEPAYONE_PACKAGE_PAYMENT_MODE", "manual");
    vi.stubEnv("THEPAYONE_PACKAGE_BILLING_ENABLED", "true");
    await expect(resolveOneTimePaymentFlow(fakeDb(false), "package"))
      .resolves.toBe("disabled");
  });
});
