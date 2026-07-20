import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  billingKeyHash,
  confirmTossPayment,
  decryptBillingKey,
  encryptBillingKey,
  issueBillingKey,
  tossCardSummary,
} from "./toss";

describe("Toss server client", () => {
  beforeEach(() => {
    vi.stubEnv("TOSS_SECRET_KEY", "test_sk_example");
    vi.stubEnv("TOSS_BILLING_KEY_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("TOSS_API_BASE_URL", "https://api.tosspayments.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("encrypts billing keys with authenticated encryption", () => {
    const encrypted = encryptBillingKey("billing-key-secret");
    expect(encrypted.ciphertext).not.toContain("billing-key-secret");
    expect(decryptBillingKey(encrypted)).toBe("billing-key-secret");
    expect(billingKeyHash("billing-key-secret")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("issues a billing key with server-only Basic authentication", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      billingKey: "billing-a",
      customerKey: "customer-a",
      card: { issuerCode: "11", number: "1234********5678" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(issueBillingKey("auth-a", "customer-a")).resolves.toMatchObject({ billingKey: "billing-a" });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/v1/billing/authorizations/issue");
    expect((init.headers as Record<string,string>).Authorization).toBe(
      `Basic ${Buffer.from("test_sk_example:").toString("base64")}`,
    );
    expect(init.body).toBe(JSON.stringify({ authKey: "auth-a", customerKey: "customer-a" }));
  });

  it("marks transport failures as an unknown payment outcome", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    await expect(issueBillingKey("auth-a", "customer-a")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      outcomeUnknown: true,
    });
  });

  it("confirms a one-time payment with the server-owned amount", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      paymentKey: "payment-a",
      orderId: "EC-ADD-order-a",
      orderName: "추가 50분",
      status: "DONE",
      totalAmount: 5900,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await confirmTossPayment("payment-a", "EC-ADD-order-a", 5900);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/v1/payments/confirm");
    expect(JSON.parse(String(init.body))).toEqual({
      paymentKey: "payment-a",
      orderId: "EC-ADD-order-a",
      amount: 5900,
    });
  });

  it("keeps only Toss-masked card metadata", () => {
    expect(tossCardSummary({ issuerCode: "11", number: "1234-5678-****-1234" })).toEqual({
      issuerCode: "11",
      cardNumberMasked: "12345678****1234",
      cardLast4: "1234",
      cardType: null,
    });
  });
});
