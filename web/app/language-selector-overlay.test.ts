import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalStyles = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

describe("language selector overlay behavior", () => {
  it("stays below overlays and disappears whenever a modal is open", () => {
    expect(globalStyles).toMatch(
      /\.language-selector-floating\s*\{[^}]*z-index:\s*40;/,
    );
    expect(globalStyles).toMatch(
      /body:has\(\[aria-modal="true"\]\) \.language-selector-floating\s*\{\s*display:\s*none;/,
    );
  });
});
