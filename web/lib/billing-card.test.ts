import { describe, expect, it } from "vitest";
import {
  formatStoredCardLabel,
  resolveStoredCardIssuer,
} from "./billing-card";

describe("stored card display", () => {
  it("shows only the masked last four digits", () => {
    expect(formatStoredCardLabel({
      last4: "5613",
    })).toBe("••5613");
  });

  it("normalizes issuer and acquirer names for display", () => {
    expect(resolveStoredCardIssuer({ issuer: "KB 국민카드" })).toBe("국민카드");
    expect(resolveStoredCardIssuer({
      issuer: "기타",
      acquirer: "현대",
    })).toBe("현대카드");
  });

  it("falls back to the stored BIN when the provider returns a generic issuer", () => {
    expect(resolveStoredCardIssuer({
      issuer: "기타",
      acquirer: null,
      cardNumberMasked: "433689******3108",
    })).toBe("하나카드");
  });

  it("does not expose a numeric provider issuer code and uses the stored BIN", () => {
    expect(resolveStoredCardIssuer({
      issuer: "11",
      cardNumberMasked: "43368900****310*",
    })).toBe("하나카드");
  });

  it("does not expose a generic provider label when the issuer is unknown", () => {
    expect(resolveStoredCardIssuer({
      issuer: "기타",
      acquirer: null,
      cardNumberMasked: "999999******1234",
    })).toBeNull();
  });
});
