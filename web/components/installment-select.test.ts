import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./installment-select.tsx", import.meta.url),
  "utf8",
);

describe("installment select", () => {
  it("shows issuer-specific benefit details in options and the selected trigger", () => {
    expect(source).toContain("optionDetails[option]");
    expect(source).toContain("optionDetails[value]");
    expect(source).toContain("installmentLabel(option)");
    expect(source).toContain("installmentLabel(value)");
    expect(source).toContain("ml-auto flex min-w-0 items-center justify-end");
    expect(source).toContain("text-right text-xs font-bold");
    expect(source).toContain("highlightedOptions.includes");
    expect(source).toContain("text-emerald-200");
    expect(source).toContain("shrink-0 whitespace-nowrap");
    expect(source).not.toContain("max-w-[70%]");
  });

  it("keeps custom listbox keyboard semantics", () => {
    expect(source).toContain('role="listbox"');
    expect(source).toContain('role="option"');
    expect(source).toContain("aria-selected={option === value}");
    expect(source).toContain('event.key === "Escape"');
  });
});
