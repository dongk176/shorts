import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chargeThePayOneRecurringCard,
  decryptCardToken,
  encryptCardToken,
  isValidLuhn,
  isSupportedCardNumber,
  registerThePayOneCard,
  revokeThePayOneCard,
  ThePayOneError,
} from "./thepayone";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");

beforeEach(() => {
  process.env.THEPAYONE_MID = "merchant-test";
  process.env.THEPAYONE_PAY_KEY = "pay-key-test";
  process.env.THEPAYONE_API_BASE_URL = "https://api.thepayone.com";
  process.env.THEPAYONE_CARD_TOKEN_ENCRYPTION_KEY = encryptionKey;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ThePayOne client", () => {
  it("sends a zero-won card-only registration with the key only in Authorization", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { resultCd: "0000", resultMsg: "정상" },
      auth: {
        trxId: "A260714000001",
        card: {
          cardId: "card_test_token",
          last4: "4242",
          issuer: "테스트카드",
          cardType: "신용",
          acquirer: "테스트",
        },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await registerThePayOneCard({
      trackId: "EC-AUTH-TEST",
      payerName: "테스트",
      payerEmail: "tester@example.com",
      payerTel: "01012345678",
      cardNumber: "4242424242424242",
      expiry: "2910",
      authDob: "900101",
      authPw: "12",
    });

    expect(result).toMatchObject({ cardId: "card_test_token", last4: "4242", resultCode: "0000" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.thepayone.com/api/auth");
    expect(new Headers(init.headers).get("Authorization")).toBe("pay-key-test");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      auth: {
        trnType: "ONTR",
        trxType: "card",
        amount: 0,
        udf2: "00",
        recurring: true,
        card: { number: "4242424242424242", expiry: "2910" },
        metadata: { authDob: "900101", authPw: "12" },
        prodName: "Easy Cut 카드등록 테스트",
        prodQty: "1",
        prodAmt: "0",
      },
    });
    expect(JSON.stringify(body)).not.toContain("merchant-test");
  });

  it("uses the submitted card suffix when the optional provider last4 is malformed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { resultCd: "0000" },
      auth: {
        trxId: "A260714000002",
        card: { cardId: "card_test_token", last4: "" },
      },
    }), { status: 200 })));

    const result = await registerThePayOneCard({
      trackId: "EC-AUTH-TEST-LAST4",
      payerName: "테스트",
      payerEmail: "tester@example.com",
      payerTel: "01012345678",
      cardNumber: "4242424242420123",
      expiry: "2910",
      authDob: "900101",
      authPw: "12",
    });
    expect(result.last4).toBe("0123");
  });

  it("uses the documented Korean 폐기 status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { resultCd: "0000" },
      audt: { trxId: "D260714000001" },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await revokeThePayOneCard("card_test_token", "EC-AUDT-TEST");
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ audt: { cardId: "card_test_token", status: "폐기", trackId: "EC-AUDT-TEST" } });
  });

  it("charges a registered card with the production recurring payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { resultCd: "0000", resultMsg: "정상" },
      pay: {
        trxId: "T260717000001",
        card: {
          last4: "4242",
          issuer: "테스트카드",
          cardType: "신용",
          acquirer: "테스트",
        },
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(chargeThePayOneRecurringCard({
      trackId: "EC-PAY-TEST",
      cardId: "card_test_token",
      amount: 1000,
      payerName: "테스트",
      payerEmail: "tester@example.com",
      payerTel: "01012345678",
      referenceId: "run-test-1",
    })).resolves.toMatchObject({
      resultCode: "0000",
      providerTransactionId: "T260717000001",
      last4: "4242",
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.thepayone.com/api/pay");
    expect(new Headers(init.headers).get("Authorization")).toBe("pay-key-test");
    expect(JSON.parse(String(init.body))).toEqual({
      pay: {
        trxType: "ONTR",
        trackId: "EC-PAY-TEST",
        amount: 1000,
        payerName: "테스트",
        payerEmail: "tester@example.com",
        payerTel: "01012345678",
        udf1: "run-test-1",
        udf2: "00",
        card: { Installment: "00", cardId: "card_test_token" },
        products: [
          {
            name: "Easy Cut 구독 결제 테스트",
            qty: "1",
            price: "1000",
            desc: "즉시 시작 1분 간격 3회 반복결제 테스트",
          },
        ],
        metadata: { recurring: "pay" },
      },
    });
  });

  it("marks a network interruption as an unknown payment outcome", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));

    await expect(chargeThePayOneRecurringCard({
      trackId: "EC-PAY-UNKNOWN",
      cardId: "card_test_token",
      amount: 1000,
      payerName: "테스트",
      payerEmail: "tester@example.com",
      payerTel: "01012345678",
      referenceId: "run-test-2",
    })).rejects.toMatchObject({
      resultCode: "NETWORK_ERROR",
      outcomeUnknown: true,
    });
  });

  it("keeps the public error generic and provides only a redacted local diagnostic", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: {
        resultCd: "9999",
        resultMsg: "전문오류 tester@example.com",
        advanceMsg: "카드번호 4242-4242-4242-4242 확인",
      },
    }), { status: 200 })));

    try {
      await registerThePayOneCard({
        trackId: "EC-AUTH-TEST",
        payerName: "테스트",
        payerEmail: "tester@example.com",
        payerTel: "01012345678",
        cardNumber: "4242424242424242",
        expiry: "2910",
        authDob: "900101",
        authPw: "12",
      });
      throw new Error("expected ThePayOne registration failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ThePayOneError);
      const providerError = error as ThePayOneError;
      expect(providerError).toMatchObject({ resultCode: "9999" });
      expect(providerError.message).not.toContain("전문오류");
      expect(providerError.diagnostic).toContain("전문오류 [이메일 숨김]");
      expect(providerError.diagnostic).toContain("[카드정보 숨김]");
      expect(providerError.diagnostic).not.toContain("tester@example.com");
      expect(providerError.diagnostic).not.toContain("4242-4242-4242-4242");
    }
  });
});

describe("card token protection", () => {
  it("encrypts cardId with authenticated context and decrypts only with the same context", () => {
    const encrypted = encryptCardToken("card_test_token", "registration-a");
    expect(encrypted.ciphertext).not.toContain("card_test_token");
    expect(decryptCardToken(encrypted, "registration-a")).toBe("card_test_token");
    expect(() => decryptCardToken(encrypted, "registration-b")).toThrow();
  });

  it("validates card numbers with Luhn without retaining formatting", () => {
    expect(isValidLuhn("4242 4242 4242 4242")).toBe(true);
    expect(isValidLuhn("4242 4242 4242 4241")).toBe(false);
  });

  it("accepts provider-supported card number shapes without requiring undocumented Luhn validation", () => {
    expect(isSupportedCardNumber("4242 4242 4242 4241")).toBe(true);
    expect(isSupportedCardNumber("1234")).toBe(false);
  });
});
