import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./manual-card-kind-select.tsx", import.meta.url),
  "utf8",
);

describe("manual card kind select", () => {
  it("offers accessible credit and debit/prepaid choices", () => {
    expect(source).toContain('role="radiogroup"');
    expect(source).toContain('role="radio"');
    expect(source).toContain('aria-required="true"');
    expect(source).toContain("aria-checked={selected}");
    expect(source).toContain("신용카드");
    expect(source).toContain("체크·선불카드");
    expect(source).toContain("일시불 결제");
    expect(source).toContain('className="block text-base"');
    expect(source).toContain("mt-1 block text-sm");
  });

  it("supports keyboard selection and missing-value attention", () => {
    expect(source).toContain('event.key !== "ArrowLeft"');
    expect(source).toContain('event.key !== "ArrowRight"');
    expect(source).toContain("data-card-kind-option");
    expect(source).toContain("attention");
  });
});
