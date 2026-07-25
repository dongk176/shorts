import { describe, expect, it } from "vitest";
import { formatStoredCardLabel } from "./billing-card";

describe("stored card display", () => {
  it("shows only the masked last four digits", () => {
    expect(formatStoredCardLabel({
      last4: "5613",
    })).toBe("••5613");
  });
});
