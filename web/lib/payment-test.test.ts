import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertSupportedPaymentTestCardIssuer,
  assertLocalPaymentMutation,
  assertLocalPaymentTestHost,
  assertPaymentTester,
  isPaymentTesterEmail,
  isHanaCardIssuerName,
  PAYMENT_TEST_CHARGE_COUNT,
  PAYMENT_TEST_INTERVAL_SECONDS,
} from "./payment-test";

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  Object.assign(process.env, {
    NODE_ENV: "development",
    PAYMENT_TEST_MODE: "true",
    PAYMENT_TESTER_EMAILS: "owner@example.com, second@example.com",
  });
});

afterEach(() => {
  Object.assign(process.env, { NODE_ENV: originalNodeEnv });
  delete process.env.PAYMENT_TEST_MODE;
  delete process.env.PAYMENT_TESTER_EMAILS;
});

function mutationRequest(url = "http://localhost:3000/api/payment-test/card-registrations") {
  return new Request(url, {
    method: "POST",
    headers: {
      Host: "localhost:3000",
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      "Sec-Fetch-Site": "same-origin",
    },
    body: "{}",
  });
}

describe("local payment test access", () => {
  it("accepts an allowlisted authenticated tester on same-origin localhost", () => {
    expect(() => assertLocalPaymentMutation(mutationRequest())).not.toThrow();
    expect(() => assertPaymentTester({
      id: "session-a",
      selectedPlanCode: "plus",
      userId: "user-a",
      user: { id: "auth-a", email: "OWNER@example.com", displayName: null, avatarUrl: null },
    })).not.toThrow();
  });

  it("accepts localhost origin when Next.js normalizes the internal URL to 0.0.0.0", () => {
    expect(() => assertLocalPaymentMutation(
      mutationRequest("http://0.0.0.0:3000/api/payment-test/card-registrations"),
    )).not.toThrow();
  });

  it("blocks remote hosts and cross-origin mutations", () => {
    expect(() => assertLocalPaymentTestHost(new Request("https://example.com/api/payment-test", {
      headers: { Host: "example.com" },
    }))).toThrow("로컬");
    const crossOrigin = mutationRequest();
    crossOrigin.headers.set("Origin", "https://evil.example");
    expect(() => assertLocalPaymentMutation(crossOrigin)).toThrow("다른 출처");
  });

  it("disables the surface in production even when the flag is present", () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    expect(() => assertLocalPaymentTestHost(mutationRequest())).toThrow("꺼져");
  });

  it("requires an explicit email allowlist", () => {
    expect(isPaymentTesterEmail("owner@example.com")).toBe(true);
    expect(isPaymentTesterEmail("unknown@example.com")).toBe(false);
  });

  it("blocks a declared Hana card with a stable UI error code", () => {
    expect(() => assertSupportedPaymentTestCardIssuer("hana")).toThrow("하나카드");
    try {
      assertSupportedPaymentTestCardIssuer("hana");
    } catch (error) {
      expect(error).toMatchObject({ status: 422, errorCode: "HANA_CARD_UNSUPPORTED" });
    }
    expect(() => assertSupportedPaymentTestCardIssuer("kb")).not.toThrow();
    expect(isHanaCardIssuerName("하나카드")).toBe(true);
    expect(isHanaCardIssuerName("KEB Hana")).toBe(true);
    expect(isHanaCardIssuerName("국민카드")).toBe(false);
  });

  it("uses three charges with one-minute gaps for new local tests", () => {
    expect(PAYMENT_TEST_CHARGE_COUNT).toBe(3);
    expect(PAYMENT_TEST_INTERVAL_SECONDS).toBe(60);
  });
});
