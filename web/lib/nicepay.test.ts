import { createDecipheriv, createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  billingKeyHash,
  chargeNicepayBillingKey,
  confirmNicepayPayment,
  createNicepayOrderId,
  decryptBillingKey,
  encryptBillingKey,
  expireNicepayBillingKey,
  registerNicepayBillingKey,
  verifyNicepayAuthSignature,
  verifyNicepayPaymentSignature,
} from "./nicepay";

const secret = "1234567890abcdef1234567890abcdef";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

describe("Nicepay server client", () => {
  beforeEach(() => {
    vi.stubEnv("NICEPAY_CLIENT_KEY", "nice-client-test");
    vi.stubEnv("NICEPAY_SECRET_KEY", secret);
    vi.stubEnv("NICEPAY_API_BASE_URL", "https://sandbox-api.nicepay.co.kr");
    vi.stubEnv("NICEPAY_BILLING_KEY_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("registers a billing key with A2 encryption and a signed request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ResultCode: "0000",
      ResultMsg: "OK",
      BID: "BIKY-test",
      TID: "nice-register-tid",
      OrderId: "BILL-order-a",
      AuthDate: "2026-07-21T10:00:00+0900",
      CardCode: "06",
      CardName: "[신한]",
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await registerNicepayBillingKey({
      orderId: "BILL-order-a",
      cardNumber: "1234567890123456",
      expiryYear: "29",
      expiryMonth: "07",
      identityNumber: "800101",
      cardPassword: "12",
      buyerName: "테스터",
    });

    expect(result).toMatchObject({ billingKey: "BIKY-test", transactionId: "nice-register-tid", issuerName: "신한" });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.encMode).toBe("A2");
    expect(body.orderId).toBe("BILL-order-a");
    expect(body.signData).toBe(sha256(`BILL-order-a${body.ediDate}${secret}`));
    const decipher = createDecipheriv("aes-256-cbc", Buffer.from(secret), Buffer.from(secret).subarray(0, 16));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(String(body.encData), "hex")),
      decipher.final(),
    ]).toString("utf8");
    expect(plaintext).toBe("cardNo=1234567890123456&expYear=29&expMonth=07&idNo=800101&cardPw=12");
  });

  it("charges and expires a billing key without exposing it in the request body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        resultCode: "0000",
        resultMsg: "OK",
        tid: "nice-payment-tid",
        orderId: "PAY-order-a",
        amount: 1000,
        status: "paid",
        paidAt: "2026-07-21T10:00:00+0900",
        card: { cardCode: "06", cardName: "신한", cardNum: "123456******1234", cardType: "credit" },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        resultCode: "0000", resultMsg: "OK", bid: "BIKY-test", orderId: "EXP-order-a", tid: "expire-tid",
      }), { status: 200 }));

    const payment = await chargeNicepayBillingKey({
      billingKey: "BIKY-test",
      orderId: "PAY-order-a",
      amount: 1000,
      goodsName: "테스트 상품",
    });
    await expireNicepayBillingKey("BIKY-test", "EXP-order-a");

    expect(payment).toMatchObject({ status: "paid", amount: 1000, cardLast4: "1234" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/v1/subscribe/BIKY-test/payments");
    expect(String(fetchMock.mock.calls[0][1]?.body)).not.toContain("BIKY-test");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/v1/subscribe/BIKY-test/expire");
  });

  it("confirms a one-time payment and validates Nicepay signatures", async () => {
    const ediDate = "2026-07-21T10:00:00+0900";
    const signature = sha256(`nice-payment-tid1000${ediDate}${secret}`);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      resultCode: "0000",
      resultMsg: "OK",
      tid: "nice-payment-tid",
      orderId: "ONE-order-a",
      amount: 1000,
      ediDate,
      signature,
      status: "paid",
      paidAt: ediDate,
    }), { status: 200 }));

    const payment = await confirmNicepayPayment("nice-payment-tid", 1000);
    expect(verifyNicepayPaymentSignature(payment)).toBe(true);
    expect(verifyNicepayAuthSignature({
      authToken: "auth-token",
      clientId: "nice-client-test",
      amount: 1000,
      signature: sha256(`auth-tokennice-client-test1000${secret}`),
    })).toBe(true);
  });

  it("protects billing keys at rest with record-bound authenticated encryption", () => {
    const encrypted = encryptBillingKey("BIKY-sensitive", "record-a");
    expect(decryptBillingKey(encrypted, "record-a")).toBe("BIKY-sensitive");
    expect(() => decryptBillingKey(encrypted, "record-b")).toThrow();
    expect(billingKeyHash("BIKY-sensitive")).toHaveLength(64);
  });

  it("creates provider-safe unique order IDs", () => {
    const orderId = createNicepayOrderId("test one");
    expect(orderId).toMatch(/^TESTONE-[A-Z0-9-]+$/);
    expect(orderId.length).toBeLessThanOrEqual(64);
  });
});
