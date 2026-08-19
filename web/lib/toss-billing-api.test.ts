import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelTossPayment,
  chargeTossBilling,
  deleteTossBillingKey,
  issueTossBillingKey,
  TossBillingApiError,
} from "./toss-billing-api";

beforeEach(() => {
  vi.stubEnv("TOSS_BILLING_ENABLED", "true");
  vi.stubEnv("TOSS_BILLING_CHARGES_ENABLED", "true");
  vi.stubEnv("TOSS_BILLING_SECRET_KEY", "unit_test_secret");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function payment(overrides: Record<string, unknown> = {}) {
  return {
    paymentKey: "pay_test_1",
    orderId: "EC-TOSS-ORDER-1",
    orderName: "이지컷 스타터",
    status: "DONE",
    totalAmount: 119_400,
    balanceAmount: 119_400,
    approvedAt: "2026-08-20T10:00:00+09:00",
    method: "카드",
    card: { issuerCode: "61", number: "43368900****310*" },
    ...overrides,
  };
}

describe("Toss billing API", () => {
  it("issues a billing key using Basic auth without exposing the secret in the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      mId: "bill_vshorabma",
      customerKey: "EC_random_customer",
      authenticatedAt: "2026-08-20T10:00:00+09:00",
      method: "카드",
      billingKey: "billing-key-secret",
      card: { issuerCode: "61", number: "43368900****310*" },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(issueTossBillingKey({
      authKey: "auth-once",
      customerKey: "EC_random_customer",
    })).resolves.toMatchObject({ billingKey: "billing-key-secret" });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.tosspayments.com/v1/billing/authorizations/issue");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      `Basic ${Buffer.from("unit_test_secret:").toString("base64")}`,
    );
    expect(String(init.body)).not.toContain("unit_test_secret");
  });

  it("charges with customerKey and an idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payment()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await chargeTossBilling({
      billingKey: "billing/key",
      customerKey: "EC_random_customer",
      amountKrw: 119_400,
      orderId: "EC-TOSS-ORDER-1",
      orderName: "이지컷 스타터 6개월",
      idempotencyKey: "idem-charge-1",
    });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.tosspayments.com/v1/billing/billing%2Fkey");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("idem-charge-1");
    expect(JSON.parse(String(init.body))).toMatchObject({
      customerKey: "EC_random_customer",
      amount: 119_400,
      orderId: "EC-TOSS-ORDER-1",
      taxFreeAmount: 0,
    });
  });

  it("uses the provider payment key and idempotency key for a partial cancel", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payment({
      balanceAmount: 99_400,
      cancels: [{
        transactionKey: "cancel-transaction-1",
        cancelAmount: 20_000,
        cancelReason: "고객 요청",
        cancelStatus: "DONE",
      }],
    })), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await cancelTossPayment({
      paymentKey: "pay_test_1",
      cancelReason: "고객 요청",
      cancelAmountKrw: 20_000,
      idempotencyKey: "idem-cancel-1",
    });
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("idem-cancel-1");
    expect(JSON.parse(String(init.body))).toEqual({
      cancelReason: "고객 요청",
      cancelAmount: 20_000,
    });
  });

  it("marks transport failures as an unknown mutation outcome", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    await expect(chargeTossBilling({
      billingKey: "billing-key",
      customerKey: "EC_random_customer",
      amountKrw: 9_900,
      orderId: "EC-TOSS-ORDER-2",
      orderName: "이지컷 프로",
      idempotencyKey: "idem-charge-2",
    })).rejects.toMatchObject({
      code: "PROVIDER_NETWORK_ERROR",
      retryable: true,
      outcomeUnknown: true,
    });
  });

  it("normalizes provider errors and deletes a billing key server-side", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: "NOT_FOUND_BILLING_KEY",
        message: "존재하지 않는 빌링키입니다.",
      }), { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(deleteTossBillingKey("missing-key")).rejects.toBeInstanceOf(TossBillingApiError);
    await expect(deleteTossBillingKey("active-key")).resolves.toBeUndefined();
    const [url] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.tosspayments.com/v1/billing/active-key");
  });
});
