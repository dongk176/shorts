import { describe, expect, it } from "vitest";
import { paymentMethodUpdatedMessage } from "./success-copy";

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
