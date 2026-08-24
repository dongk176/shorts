import { describe, expect, it } from "vitest";
import {
  packagePaymentCompletedMessage,
  paymentMethodUpdatedMessage,
} from "./success-copy";

describe("paymentMethodUpdatedMessage", () => {
  it("shows the issuer and last four digits of the newly stored card", () => {
    expect(paymentMethodUpdatedMessage({
      cardIssuer: "신한카드",
      cardLast4: "1234",
    })).toBe("신한카드 · 끝번호 1234 카드로 정기결제 수단이 변경되었습니다.");
  });

  it("does not expose more than the last four numeric digits", () => {
    expect(paymentMethodUpdatedMessage({
      cardIssuer: "삼성카드",
      cardLast4: "****-5678",
    })).toBe("삼성카드 · 끝번호 5678 카드로 정기결제 수단이 변경되었습니다.");
  });

  it("uses a safe fallback when card metadata is unavailable", () => {
    expect(paymentMethodUpdatedMessage(null)).toBe("새 카드로 정기결제 수단이 변경되었습니다.");
  });
});

describe("packagePaymentCompletedMessage", () => {
  it("shows a concise package, payment, and next quota summary on separate lines", () => {
    expect(packagePaymentCompletedMessage({
      orderName: "Easy Cut 전문가 패키지 6개월",
      chargedAmountKrw: 288_000,
      installmentMonths: 6,
      nextQuotaAt: "2026-08-30T00:00:00+09:00",
    })).toBe([
      "전문가 패키지 6개월",
      "288,000원 · 6개월 할부",
      "다음 기본시간: 2026년 8월 30일",
    ].join("\n"));
  });

  it("uses a short cash-payment summary when there is no installment", () => {
    expect(packagePaymentCompletedMessage({
      orderName: "Easy Cut 스타터 패키지 3개월",
      chargedAmountKrw: 70_965,
      installmentMonths: 0,
    })).toBe([
      "스타터 패키지 3개월",
      "70,965원 · 일시불",
    ].join("\n"));
  });
});
