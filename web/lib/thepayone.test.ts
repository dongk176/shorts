import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cardTokenHash,
  chargeThePayOneCard,
  chargeThePayOneManualCard,
  chargeThePayOneRecurringCard,
  createPaymentTrackId,
  decryptCardToken,
  encryptCardToken,
  parseThePayOneWebhook,
  PaymentConfigurationError,
  refundThePayOnePayment,
  registerThePayOneCard,
  revokeThePayOneCard,
  thePayOneRecurringTrackIdBase,
  thePayOneCredentialScopeForPackage,
  thePayOneCredentialScopeForMerchantTerminal,
  thePayOneCardTypeAllowsInstallment,
  thePayOneCardTypeMatchesDeclaredKind,
  thePayOneInstallmentMaxMonths,
  thePayOneRefundMismatchFields,
  thePayOneTaxBreakdown,
  ThePayOneError,
} from "./thepayone";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");

beforeEach(() => {
  vi.stubEnv("THEPAYONE_PAY_KEY", "pay-key-test");
  vi.stubEnv("THEPAYONE_MID", "merchant-default");
  vi.stubEnv("THEPAYONE_TERMINAL_ID", "recurring01");
  vi.stubEnv("THEPAYONE_PACKAGE_MID", "merchant-default");
  vi.stubEnv("THEPAYONE_PACKAGE_TERMINAL_ID", "arti02");
  vi.stubEnv("THEPAYONE_PACKAGE_PAY_KEY", "package-pay-key-test");
  vi.stubEnv("THEPAYONE_API_BASE_URL", "https://api.thepayone.com");
  vi.stubEnv("THEPAYONE_CARD_TOKEN_ENCRYPTION_KEY", encryptionKey);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ThePayOne client", () => {
  it("keeps track IDs within the recurring payment limit after the provider suffix", () => {
    expect(createPaymentTrackId("AUTH")).toHaveLength(31);
    for (const prefix of ["AUTH", "AUDT", "PAY", "REFUND"] as const) {
      const trackId = createPaymentTrackId(prefix);
      expect(trackId).toMatch(new RegExp(`^EC-${prefix}-\\d{6}-[a-f0-9]{16}$`));
      expect(trackId.length).toBeLessThanOrEqual(33);
      expect(`${trackId}235959`.length).toBeLessThanOrEqual(50);
    }
  });

  it("extracts only a valid HHmmss suffix from a scheduled recurring track ID", () => {
    const stored = "EC-AUTH-260725-0123456789abcdef0123";
    expect(thePayOneRecurringTrackIdBase(`${stored}134418`)).toBe(stored);
    expect(thePayOneRecurringTrackIdBase(`${stored}246060`)).toBeNull();
    expect(thePayOneRecurringTrackIdBase(stored)).toBeNull();
  });

  it("extracts a definite provider installment limit without treating other 9999 diagnostics as a limit", () => {
    expect(thePayOneInstallmentMaxMonths(
      "할부개월초과 / 할부기간은 6개월 이하로 이용하여 주시기 바랍니다.",
    )).toBe(6);
    expect(thePayOneInstallmentMaxMonths("할부 개월수는 12개월 이하")).toBe(12);
    expect(thePayOneInstallmentMaxMonths("승인실패 / 카드사 문의")).toBeNull();
    expect(thePayOneInstallmentMaxMonths(null)).toBeNull();
  });

  it("allows installments only when the provider explicitly identifies a credit card", () => {
    expect(thePayOneCardTypeAllowsInstallment("신용", 3)).toBe(true);
    expect(thePayOneCardTypeAllowsInstallment(" 신용카드 ", 3)).toBe(true);
    expect(thePayOneCardTypeAllowsInstallment("CREDIT_CARD", 3)).toBe(true);
    expect(thePayOneCardTypeAllowsInstallment("체크", 3)).toBe(false);
    expect(thePayOneCardTypeAllowsInstallment("debit", 3)).toBe(false);
    expect(thePayOneCardTypeAllowsInstallment(null, 3)).toBe(false);
    expect(thePayOneCardTypeAllowsInstallment("체크", 0)).toBe(true);
  });

  it("normalizes the provider card type against the customer's card-kind choice", () => {
    expect(thePayOneCardTypeMatchesDeclaredKind("신용카드", "credit")).toBe(true);
    expect(thePayOneCardTypeMatchesDeclaredKind("CREDIT_CARD", "credit")).toBe(true);
    expect(thePayOneCardTypeMatchesDeclaredKind("체크", "credit")).toBe(false);
    expect(thePayOneCardTypeMatchesDeclaredKind("체크카드", "debit_prepaid")).toBe(true);
    expect(thePayOneCardTypeMatchesDeclaredKind("DEBIT_CARD", "debit_prepaid")).toBe(true);
    expect(thePayOneCardTypeMatchesDeclaredKind("선불", "debit_prepaid")).toBe(true);
    expect(thePayOneCardTypeMatchesDeclaredKind(null, "debit_prepaid")).toBe(false);
  });

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
      amount: 0,
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

  it("uses the package key for direct manual-card approval without registration", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { resultCd: "0000", resultMsg: "정상" },
      pay: {
        trxId: "T260729000001",
        trackId: "EC-PAY-PACKAGE",
        amount: 1000,
        tmnId: "arti02",
        card: { cardId: "package_response_card", last4: "4242", installment: "00" },
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await chargeThePayOneManualCard({
      trackId: "EC-PAY-PACKAGE",
      payerName: "테스트",
      payerEmail: "tester@example.com",
      payerTel: "01012345678",
      cardNumber: "4242424242424242",
      expiry: "2910",
      authDob: "900101",
      authPw: "12",
      amount: 1000,
      installmentMonths: 0,
      productName: "패키지 수기결제 테스트",
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.thepayone.com/api/pay");
    expect(new Headers(init.headers).get("Authorization")).toBe("package-pay-key-test");
    const body = JSON.parse(String(init.body));
    expect(body.pay).toMatchObject({
      trxType: "ONTR",
      udf2: "00",
      card: {
        number: "4242424242424242",
        expiry: "2910",
        installment: "00",
      },
      metadata: { cardAuth: "true", authDob: "900101", authPw: "12" },
    });
    expect(body.pay.card).not.toHaveProperty("cardId");
    expect(body.pay.metadata).not.toHaveProperty("recurring");
    expect(thePayOneCredentialScopeForMerchantTerminal(
      "merchant-default",
      "arti02",
    )).toBe("manual");
  });

  it("prevents package card registration and default-terminal manual approval", async () => {
    await expect(registerThePayOneCard({
      trackId: "EC-AUTH-PACKAGE-BLOCKED",
      amount: 0,
      payerName: "테스트",
      payerEmail: "tester@example.com",
      payerTel: "01012345678",
      cardNumber: "4242424242424242",
      expiry: "2910",
      authDob: "900101",
      authPw: "12",
    }, "package")).rejects.toBeInstanceOf(PaymentConfigurationError);
    await expect(chargeThePayOneManualCard({
      trackId: "EC-PAY-DEFAULT-BLOCKED",
      payerName: "테스트",
      payerEmail: "tester@example.com",
      payerTel: "01012345678",
      cardNumber: "4242424242424242",
      expiry: "2910",
      authDob: "900101",
      authPw: "12",
      amount: 1_000,
      productName: "잘못된 터미널",
    }, "default")).rejects.toBeInstanceOf(PaymentConfigurationError);
  });

  it("selects manual credentials only after the mode and credential gate are enabled", () => {
    vi.stubEnv("THEPAYONE_PACKAGE_PAYMENT_MODE", "manual");
    vi.stubEnv("THEPAYONE_PACKAGE_BILLING_ENABLED", "false");
    expect(thePayOneCredentialScopeForPackage(true)).toBe("default");
    vi.stubEnv("THEPAYONE_PACKAGE_BILLING_ENABLED", "true");
    expect(thePayOneCredentialScopeForPackage(true)).toBe("manual");
    expect(thePayOneCredentialScopeForPackage(false)).toBe("default");
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

  it("sends package-terminal 3-month installments as 03", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { resultCd: "0000", create: "20260729153000" },
      pay: {
        trxId: "T260729000003",
        trackId: "EC-PACKAGE-3M",
        amount: 50000,
        tmnId: "arti02",
        card: {
          cardId: "package_card_token",
          installment: "03",
          cardType: "신용",
        },
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(chargeThePayOneManualCard({
      trackId: "EC-PACKAGE-3M",
      cardNumber: "4242424242424242",
      expiry: "2910",
      authDob: "900101",
      authPw: "12",
      amount: 50_000,
      payerName: "테스트",
      payerEmail: "tester@example.com",
      payerTel: "01012345678",
      installmentMonths: 3,
      productName: "패키지 3개월 테스트",
    })).resolves.toMatchObject({
      amount: 50_000,
      terminalId: "arti02",
      installmentMonths: 3,
      cardType: "신용",
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(new Headers(init.headers).get("Authorization")).toBe("package-pay-key-test");
    expect(body.pay.card).toEqual({
      number: "4242424242424242",
      expiry: "2910",
      installment: "03",
    });
    expect(body.pay.metadata).toEqual({
      cardAuth: "true",
      authDob: "900101",
      authPw: "12",
    });
  });

  it("registers a production monthly schedule at the recurring plan price", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { resultCd: "0000" },
      auth: {
        trxId: "A260722000001",
        trackId: "EC-AUTH-PRODUCTION",
        amount: 9_900,
        udf2: "22",
        card: { cardId: "card_monthly_token", last4: "1234", issuer: "테스트카드" },
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await registerThePayOneCard({
      trackId: "EC-AUTH-PRODUCTION",
      amount: 9_900,
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
      amount: 9_900,
      udf2: "22",
      recurring: true,
      prodAmt: "9900",
      metadata: { authDob: "900101", authPw: "12" },
    });
  });

  it("rejects a zero-won registration when a recurring billing day is present", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(registerThePayOneCard({
      trackId: "EC-AUTH-ZERO-SCHEDULE",
      amount: 0,
      payerName: "테스트",
      payerEmail: "tester@example.com",
      payerTel: "01012345678",
      cardNumber: "4242424242424242",
      expiry: "2910",
      authDob: "900101",
      authPw: "12",
      billingDay: "22",
      productName: "Easy Cut Standard 월간",
    })).rejects.toMatchObject({ resultCode: "INVALID_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
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
        amount: 0,
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
  it("parses the provider's flat form payload without a response= wrapper", () => {
    const parsed = parseThePayOneWebhook(
      "last4=*017&rootTrxId=&authCd=30006532&tmnId=terminal-1"
      + "&regDate=2026%2F08%2F21+13%3A44%3A21.342&trxType=pay"
      + "&prodName=Easy+Cut+Pro&amount=9900&trackId=EC-SUB-TEST"
      + "&trxId=T260821000001&regDay=20260821&trxDay=20260821&regTime=134418"
      + "&installment=00&cardId=card_test_token&mchtId=merchant-1",
    );
    expect(parsed).toMatchObject({
      merchantId: "merchant-1",
      terminalId: "terminal-1",
      transactionId: "T260821000001",
      trackId: "EC-SUB-TEST",
      transactionType: "pay",
      amount: 9_900,
      cardId: "card_test_token",
      last4: null,
      authCode: "30006532",
      transactionDay: "20260821",
      registeredDay: "20260821",
      registeredTime: "134418",
      installmentMonths: 0,
    });
  });

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
