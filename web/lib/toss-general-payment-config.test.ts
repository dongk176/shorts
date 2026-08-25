import { afterEach, describe, expect, it, vi } from "vitest";
import {
  tossGeneralPaymentEnabled,
  tossGeneralPaymentKeys,
} from "./toss-general-payment-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Toss general payment configuration", () => {
  it("is disabled by default", () => {
    vi.stubEnv("TOSS_GENERAL_PAYMENT_ENABLED", "false");
    expect(tossGeneralPaymentEnabled()).toBe(false);
    expect(() => tossGeneralPaymentKeys()).toThrow("활성화되지 않았습니다");
  });

  it("accepts only a paired payment-window gck/gsk environment", () => {
    vi.stubEnv("TOSS_GENERAL_PAYMENT_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_TOSS_CLIENT_KEY", "test_gck_client");
    vi.stubEnv("TOSS_SECRET_KEY", "test_gsk_secret");
    expect(tossGeneralPaymentKeys()).toEqual({
      clientKey: "test_gck_client",
      secretKey: "test_gsk_secret",
    });
  });

  it("rejects billing keys and mixed live/test keys", () => {
    vi.stubEnv("TOSS_GENERAL_PAYMENT_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_TOSS_CLIENT_KEY", "test_ck_billing");
    vi.stubEnv("TOSS_SECRET_KEY", "test_sk_billing");
    expect(() => tossGeneralPaymentKeys()).toThrow("결제창형");

    vi.stubEnv("NEXT_PUBLIC_TOSS_CLIENT_KEY", "live_gck_client");
    vi.stubEnv("TOSS_SECRET_KEY", "test_gsk_secret");
    expect(() => tossGeneralPaymentKeys()).toThrow("환경이 일치하지 않습니다");
  });
});
