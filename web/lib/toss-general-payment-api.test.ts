import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmTossGeneralPayment,
  getTossGeneralPaymentByOrderId,
} from "./toss-general-payment-api";

function payment(overrides: Record<string, unknown> = {}) {
  return {
    paymentKey: "payment-key-1",
    orderId: "ent_order_1",
    orderName: "파일럿 이용료",
    type: "NORMAL",
    status: "DONE",
    method: "카드",
    totalAmount: 363000,
    approvedAt: "2026-08-25T12:00:00+09:00",
    receipt: { url: "https://dashboard.tosspayments.com/receipt/test" },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Toss general payment API", () => {
  it("confirms the exact stored order and amount with basic auth and idempotency", async () => {
    vi.stubEnv("TOSS_GENERAL_PAYMENT_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_TOSS_CLIENT_KEY", "test_gck_client");
    vi.stubEnv("TOSS_SECRET_KEY", "test_gsk_secret");
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe(
        `Basic ${Buffer.from("test_gsk_secret:").toString("base64")}`,
      );
      expect(headers.get("Idempotency-Key")).toBe("attempt-id");
      expect(JSON.parse(String(init?.body))).toEqual({
        paymentKey: "payment-key-1",
        orderId: "ent_order_1",
        amount: 363000,
      });
      return new Response(JSON.stringify(payment()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(confirmTossGeneralPayment({
      paymentKey: "payment-key-1",
      orderId: "ent_order_1",
      amount: 363000,
      idempotencyKey: "attempt-id",
    })).resolves.toMatchObject({
      status: "DONE",
      method: "카드",
      totalAmount: 363000,
    });
  });

  it("queries an uncertain result by its server-issued order id", async () => {
    vi.stubEnv("TOSS_GENERAL_PAYMENT_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_TOSS_CLIENT_KEY", "test_gck_client");
    vi.stubEnv("TOSS_SECRET_KEY", "test_gsk_secret");
    const fetchMock = vi.fn(async (url: URL, init?: RequestInit) => {
      expect(url.pathname).toBe("/v1/payments/orders/ent_order_1");
      expect(init?.method).toBe("GET");
      return new Response(JSON.stringify(payment()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(getTossGeneralPaymentByOrderId("ent_order_1"))
      .resolves.toMatchObject({ orderId: "ent_order_1" });
  });

  it("returns a bounded provider error without exposing the secret", async () => {
    vi.stubEnv("TOSS_GENERAL_PAYMENT_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_TOSS_CLIENT_KEY", "test_gck_client");
    vi.stubEnv("TOSS_SECRET_KEY", "test_gsk_secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      code: "REJECT_CARD_PAYMENT",
      message: "카드 승인이 거절되었습니다.",
    }), { status: 400 })));
    await expect(confirmTossGeneralPayment({
      paymentKey: "payment-key-1",
      orderId: "ent_order_1",
      amount: 363000,
      idempotencyKey: "attempt-id",
    })).rejects.toMatchObject({
      code: "REJECT_CARD_PAYMENT",
      status: 400,
      outcomeUnknown: false,
    });
  });
});
