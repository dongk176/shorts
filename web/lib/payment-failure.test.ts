import { describe, expect, it } from "vitest";
import {
  thePayOneUserPaymentFailure,
  userPaymentFailureForCode,
} from "./payment-failure";

describe("payment failure presentation", () => {
  it("turns identity rejection into an actionable message without a provider code", () => {
    const failure = thePayOneUserPaymentFailure(
      "2044",
      "승인실패 / 주민번호 / 사업자번호 오류 (카드사)",
    );

    expect(failure).toMatchObject({
      code: "PAYMENT_IDENTITY_INVALID",
      title: "본인확인 정보를 확인해 주세요",
      field: "identityNumber",
    });
    expect(failure.detail).toContain("생년월일 6자리");
    expect(failure.detail).not.toContain("2044");
  });

  it.each([
    ["2041", "PAYMENT_CARD_PASSWORD_INVALID", "cardPassword"],
    ["2015", "PAYMENT_CARD_EXPIRY_INVALID", "expiryMonth"],
    ["9124", "PAYMENT_CARD_NUMBER_INVALID", "cardNumber"],
    ["2021", "PAYMENT_INSTALLMENT_INVALID", "installments"],
    ["2061", "PAYMENT_LIMIT_EXCEEDED", null],
    ["2075", "PAYMENT_BALANCE_INSUFFICIENT", null],
  ])("maps provider rejection %s", (providerCode, code, field) => {
    expect(thePayOneUserPaymentFailure(providerCode, null)).toMatchObject({ code, field });
  });

  it("uses a safe generic message for an unknown rejection", () => {
    const failure = thePayOneUserPaymentFailure("9999", "unmapped provider detail");
    expect(failure.code).toBe("PAYMENT_PROVIDER_REJECTED");
    expect(failure.detail).not.toContain("9999");
    expect(userPaymentFailureForCode(failure.code)).toEqual(failure);
  });
});
