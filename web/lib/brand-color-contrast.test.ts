import { describe, expect, it } from "vitest";
import { contrastingTitleTextColor } from "./brand-color-contrast";

describe("brand color title contrast", () => {
  it("uses white text on dark brand colors", () => {
    expect(contrastingTitleTextColor("#040404")).toBe("#FFFFFF");
    expect(contrastingTitleTextColor("#2563EB")).toBe("#FFFFFF");
  });

  it("uses black text on light brand colors", () => {
    expect(contrastingTitleTextColor("#FFD84D")).toBe("#000000");
    expect(contrastingTitleTextColor("#35E6E3")).toBe("#000000");
  });

  it("fails safely for an invalid color", () => {
    expect(contrastingTitleTextColor("not-a-color")).toBe("#FFFFFF");
  });
});
