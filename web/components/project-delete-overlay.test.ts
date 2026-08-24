import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./project-delete-overlay.tsx", import.meta.url),
  "utf8",
);

describe("project delete overlay", () => {
  it("is isolated from the payment overlay and preserves the viewport", () => {
    expect(source).toContain("createPortal(");
    expect(source).toContain("document.body");
    expect(source).toContain("preventScroll: true");
    expect(source).toContain("window.scrollTo(x, y)");
    expect(source).toContain('document.addEventListener("touchmove"');
    expect(source).not.toContain("PaymentMessageOverlay");
  });
});
