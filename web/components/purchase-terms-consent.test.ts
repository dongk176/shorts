import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./purchase-terms-consent.tsx", import.meta.url),
  "utf8",
);

describe("purchase terms consent", () => {
  it("toggles from the full card while preserving independent links and checkbox input", () => {
    expect(source).toContain("onChange(!checked)");
    expect(source).toContain('target.closest("a, input")');
    expect(source).toContain("cursor-pointer");
    expect(source).toContain("required");
  });

  it("does not expose a refund-policy navigation link in the payment consent", () => {
    expect(source).not.toContain('href="/refund"');
    expect(source).toContain("취소·환불 규정");
  });
});
