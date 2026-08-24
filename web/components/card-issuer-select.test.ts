import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./card-issuer-select.tsx", import.meta.url),
  "utf8",
);

describe("card issuer select", () => {
  it("uses an accessible custom listbox instead of a native select", () => {
    expect(source).toContain('role="listbox"');
    expect(source).toContain('role="option"');
    expect(source).toContain("aria-expanded={open}");
    expect(source).toContain("aria-selected={option.value === value}");
    expect(source).not.toContain("<select");
    expect(source).toContain("data-card-issuer-trigger");
    expect(source).toContain("attention && !value");
    expect(source).toContain("motion-safe:animate-pulse");
    expect(source).toContain("top-[calc(100%+0.5rem)]");
    expect(source).toContain("sm:bottom-[calc(100%+0.5rem)]");
    expect(source).toContain("sm:top-auto");
    expect(source).toContain('open ? "rotate-180 sm:rotate-0" : "sm:rotate-180"');
    expect(source).toContain('open ? "z-[80]" : "z-0"');
    expect(source).toContain("bg-[#25282a]");
    expect(source).not.toContain("bg-[#25282a]/98");
  });

  it("supports keyboard navigation and closing the overlay", () => {
    expect(source).toContain('event.key === "ArrowDown"');
    expect(source).toContain('event.key === "ArrowUp"');
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain('event.key === "Home"');
    expect(source).toContain('event.key === "End"');
    expect(source).toContain('"pointerdown"');
    expect(source).toContain("triggerRef.current?.focus()");
  });
});
