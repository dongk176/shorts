import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cardTokenHash,
  chargeThePayOneCard,
  chargeThePayOneRecurringCard,
  decryptCardToken,
  encryptCardToken,
  parseThePayOneWebhook,
  refundThePayOnePayment,
  registerThePayOneCard,
  revokeThePayOneCard,
  thePayOneRefundMismatchFields,
  thePayOneTaxBreakdown,
  ThePayOneError,
} from "./thepayone";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");

beforeEach(() => {
  vi.stubEnv("THEPAYONE_PAY_KEY", "pay-key-test");
  vi.stubEnv("THEPAYONE_API_BASE_URL", "https://api.thepayone.com");
  vi.stubEnv("THEPAYONE_CARD_TOKEN_ENCRYPTION_KEY", encryptionKey);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ThePayOne client", () => {
  it("sends authPw in the zero-won card registration metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { resultCd: "0000", resultMsg: "정상" },
      auth: {
        trxId: "A260714000001",
        card: { cardId: "card_test_token", last4: "4242", issuer: "테스트카드" },
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(registerThePayOneCard({
      trackId: "EC-AUTH-TEST",
      payerName: "테스트",
      payerEmail: "tester@example.com",
      payerTel: "01012345678",
      cardNumber: "4242424242424242",
      expiry: "2910",
      authDob: "900101",
      authPw: "12",
    })).resolves.toMatchObject({ cardId: "card_test_token", last4: "4242" });

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
        metadata: { cardAuth: "true", authDob: "900101", authPw: "12" },
        prodAmt: "0",
      },
    });
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

  it("charges a cardId with a three-minute, five-charge test description", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { resultCd: "0000", resultMsg: "정상" },
      pay: {
        trxId: "T260717000001",
        trackId: "EC-PAY-TEST",
        amount: 1000,
        tmnId: "TMN-TEST",
        card: { cardId: "card_test_token", last4: "4242", issuer: "테스트카드" },
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(chargeThePayOneRecurringCard({
      trackId: "EC-PAY-TEST",
      cardId: "card_test_token",
      authDob: "900101",
      authPw: "12",
      amount: 1000,
      payerName: "테스트",
      payerEmail: "tester@example.com",
      payerTel: "01012345678",
      referenceId: "run-test-1",
      sequenceNo: 1,
      targetChargeCount: 5,
      intervalSeconds: 180,
    })).resolves.toMatchObject({
      resultCode: "0000",
      providerTransactionId: "T260717000001",
      trackId: "EC-PAY-TEST",
      amount: 1000,
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.pay).toMatchObject({
      trxType: "ONTR",
      udf2: "00",
      card: { Installment: "00", cardId: "card_test_token" },
      products: [{ desc: "3분 간격 5회 테스트" }],
      metadata: { recurring: "pay", cardAuth: "true", authDob: "900101", authPw: "12" },
    });
  });

  it("sends and verifies a two-digit annual installment selection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { resultCd: "0000", resultMsg: "정상", create: "20260724153000" },
      pay: {
        trxId: "T260724000001",
        trackId: "EC-YEARLY-TEST",
        amount: 191040,
        tmnId: "TMN-TEST",
        authCd: "12345678",
        card: {
          cardId: "card_test_token",
          last4: "4242",
          issuer: "국민카드",
          Installment: "10",
        },
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await chargeThePayOneCard({
      trackId: "EC-YEARLY-TEST",
      cardId: "card_test_token",
      authDob: "900101",
      authPw: "12",
      amount: 191_040,
      payerName: "테스트",
      payerEmail: "tester@example.com",
      payerTel: "01012345678",
      billingDay: "00",
      installmentMonths: 10,
      productName: "Easy Cut Standard 연간 구독",
    });
    expect(result).toMatchObject({
      installmentMonths: 10,
      authCode: "12345678",
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.pay.card.Installment).toBe("10");
  });

  it("registers a production monthly schedule at zero won with the billing day", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { resultCd: "0000" },
      auth: {
        trxId: "A260722000001",
        trackId: "EC-AUTH-PRODUCTION",
        amount: 0,
        udf2: "22",
        card: { cardId: "card_monthly_token", last4: "1234", issuer: "테스트카드" },
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await registerThePayOneCard({
      trackId: "EC-AUTH-PRODUCTION",
      payerName: "테스트",
      payerEmail: "tester@example.com",
      payerTel: "01012345678",
      cardNumber: "4242424242424242",
      expiry: "2910",
      authDob: "900101",
      authPw: "12",
      billingDay: "22",
      productName: "Easy Cut Standard 월간",
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.auth).toMatchObject({
      trnType: "ONTR",
      trxType: "card",
      amount: 0,
      udf2: "22",
      recurring: true,
      prodAmt: "0",
      metadata: { authDob: "900101", authPw: "12" },
    });
  });

  it("marks a network interruption as an unknown payment outcome", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));

    await expect(chargeThePayOneRecurringCard({
      trackId: "EC-PAY-UNKNOWN",
      cardId: "card_test_token",
      authDob: "900101",
      authPw: "12",
      amount: 1000,
      payerName: "테스트",
      payerEmail: "tester@example.com",
      payerTel: "01012345678",
      referenceId: "run-test-2",
      sequenceNo: 2,
      targetChargeCount: 5,
      intervalSeconds: 180,
    })).rejects.toMatchObject({ resultCode: "NETWORK_ERROR", outcomeUnknown: true });
  });

  it("refunds an approved transaction with a new idempotent track id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { resultCd: "0000", create: "20260722163000" },
      refund: {
        rootTrxId: "T260722000001",
        rootTrackId: "EC-SUB-original",
        trxId: "R260722000001",
        tmnId: "TMN-TEST",
        trackId: "EC-REFUND-1",
        amount: 9_900,
        taxAmt: 9_000,
        vatAmt: 900,
        taxFreeAmt: 0,
        serviceAmt: 0,
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(refundThePayOnePayment({
      trackId: "EC-REFUND-1",
      rootTransactionId: "T260722000001",
      amount: 9_900,
      referenceId: "refund-record-1",
      reason: "고객 요청 전액 환불",
    })).resolves.toMatchObject({
      providerTransactionId: "R260722000001",
      rootTransactionId: "T260722000001",
      rootTrackId: "EC-SUB-original",
      trackId: "EC-REFUND-1",
      amount: 9_900,
      taxAmount: 9_000,
      vatAmount: 900,
      terminalId: "TMN-TEST",
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.thepayone.com/api/refund");
    expect(JSON.parse(String(init.body))).toEqual({
      refund: {
        trackId: "EC-REFUND-1",
        amount: 9_900,
        rootTrxId: "T260722000001",
        taxAmt: 9_000,
        vatAmt: 900,
        taxFreeAmt: 0,
        serviceAmt: 0,
        udf1: "refund-record-1",
        metadata: { reason: "고객 요청 전액 환불" },
      },
    });
  });

  it("splits a VAT-inclusive partial refund amount exactly", () => {
    expect(thePayOneTaxBreakdown(10_104)).toEqual({
      taxAmount: 9_185,
      vatAmount: 919,
      taxFreeAmount: 0,
      serviceAmount: 0,
    });
  });

  it("accepts a successful refund response when optional root references are omitted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { resultCd: "0000", create: "20260722163000" },
      refund: {
        trxId: "R260722000002",
        tmnId: "TMN-TEST",
        trackId: "EC-REFUND-2",
        amount: 10_104,
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const refund = await refundThePayOnePayment({
      trackId: "EC-REFUND-2",
      rootTransactionId: "T260722000002",
      amount: 10_104,
    });

    expect(refund).toMatchObject({
      rootTransactionId: "T260722000002",
      rootTrackId: null,
      amount: 10_104,
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.refund).toMatchObject({
      amount: 10_104,
      taxAmt: 9_185,
      vatAmt: 919,
      taxFreeAmt: 0,
      serviceAmt: 0,
      metadata: { reason: "Easy Cut 관리자 환불" },
    });
    expect(thePayOneRefundMismatchFields(refund, {
      trackId: "EC-REFUND-2",
      rootTransactionId: "T260722000002",
      amount: 10_104,
      terminalId: "TMN-TEST",
    })).toEqual([]);
  });

  it("does not use the optional root track id as a refund reconciliation key", () => {
    expect(thePayOneRefundMismatchFields({
      resultCode: "0000",
      providerTransactionId: "R260722000003",
      rootTransactionId: "T260722000003",
      rootTrackId: "provider-generated-root-track",
      trackId: "EC-REFUND-3",
      amount: 10_104,
      terminalId: "TMN-TEST",
      refundedAt: new Date("2026-07-23T00:00:00.000Z"),
    }, {
      trackId: "EC-REFUND-3",
      rootTransactionId: "T260722000003",
      amount: 10_104,
      terminalId: "TMN-TEST",
    })).toEqual([]);
  });

  it("reports only security-relevant refund response mismatches", () => {
    expect(thePayOneRefundMismatchFields({
      resultCode: "0000",
      providerTransactionId: "R260722000004",
      rootTransactionId: "wrong-root",
      rootTrackId: null,
      trackId: "wrong-track",
      amount: 1,
      terminalId: "wrong-terminal",
      refundedAt: new Date("2026-07-23T00:00:00.000Z"),
    }, {
      trackId: "EC-REFUND-4",
      rootTransactionId: "T260722000004",
      amount: 10_104,
      terminalId: "TMN-TEST",
    })).toEqual(["trackId", "rootTransactionId", "amount", "terminalId"]);
  });

  it("redacts provider diagnostics before exposing them to callers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: {
        resultCd: "9999",
        resultMsg: "전문오류 tester@example.com",
        advanceMsg: "카드번호 4242-4242-4242-4242 연락처 010-1234-5678 확인",
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
      expect(providerError.diagnostic).toContain("[이메일 숨김]");
      expect(providerError.diagnostic).toContain("[카드정보 숨김]");
      expect(providerError.diagnostic).toContain("[연락처 숨김]");
      expect(providerError.diagnostic).not.toContain("tester@example.com");
      expect(providerError.diagnostic).not.toContain("4242-4242-4242-4242");
      expect(providerError.diagnostic).not.toContain("010-1234-5678");
    }
  });
});

describe("cardId protection", () => {
  it("encrypts cardId with authenticated context and stores only a one-way lookup hash", () => {
    const encrypted = encryptCardToken("card_test_token", "registration-a");
    expect(encrypted.ciphertext).not.toContain("card_test_token");
    expect(decryptCardToken(encrypted, "registration-a")).toBe("card_test_token");
    expect(() => decryptCardToken(encrypted, "registration-b")).toThrow();
    expect(cardTokenHash("card_test_token")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("ThePayOne result notification", () => {
  it("parses the documented response= nested query format", () => {
    const parsed = parseThePayOneWebhook(
      "response=mchtId=merchant-1&tmnId=terminal-1&trxId=T260722000001&trackId=EC-ADD-1"
      + "&trxType=pay&amount=9900&cardId=card_test_token&last4=4242&issuer=%EC%82%BC%EC%84%B1%EC%B9%B4%EB%93%9C",
    );
    expect(parsed).toMatchObject({
      merchantId: "merchant-1",
      terminalId: "terminal-1",
      transactionId: "T260722000001",
      trackId: "EC-ADD-1",
      transactionType: "pay",
      amount: 9_900,
      cardId: "card_test_token",
      last4: "4242",
      issuer: "삼성카드",
      installmentMonths: 0,
    });
  });

  it("parses installment months and approval fields from a payment notification", () => {
    expect(parseThePayOneWebhook(
      "response=mchtId=merchant-1&tmnId=terminal-1&trxId=T260724000002&trackId=EC-YEARLY-2"
      + "&trxType=pay&amount=191040&cardId=card_test_token&installment=10&authCd=87654321&trxDay=20260724",
    )).toMatchObject({
      installmentMonths: 10,
      authCode: "87654321",
      transactionDay: "20260724",
    });
  });

  it("rejects a notification without a transaction id", () => {
    expect(() => parseThePayOneWebhook(
      "response=mchtId=merchant-1&tmnId=terminal-1&trackId=EC-ADD-1&trxType=pay&amount=9900&cardId=card",
    )).toThrow("결과 통지");
  });

  it("accepts a refund notification when the optional root transaction id is omitted", () => {
    expect(parseThePayOneWebhook(
      "response=mchtId=merchant-1&tmnId=terminal-1&trxId=R260722000001&trackId=EC-REFUND-1"
      + "&trxType=refund&amount=10104&cardId=card_test_token",
    )).toMatchObject({
      transactionType: "refund",
      amount: 10_104,
      rootTransactionId: null,
    });
  });
});
