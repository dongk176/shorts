import { describe, expect, it } from "vitest";
import { fitPreviewTitleFont, wrapPreviewTitle } from "./title-preview";

describe("render-matched title preview", () => {
  it("preserves two user-authored lines without wrapping either line again", () => {
    expect(wrapPreviewTitle("4억 투자 올인, 다\n8400만원 남아……")).toEqual([
      "4억 투자 올인, 다",
      "8400만원 남아……",
    ]);
  });

  it("matches the renderer's two-line 20-character wrapping limit", () => {
    const lines = wrapPreviewTitle("사람들이 가장 많이 놓치는 결정적인 핵심 장면입니다");
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => Array.from(line.replace(/…$/, "")).length <= 20)).toBe(true);
  });

  it("fits the longest fixed line into the renderer's 930px title width", () => {
    const size = fitPreviewTitleFont(["1234567890"], (line, fontSize) => line.length * fontSize);
    expect(size).toBe(84);
    const smaller = fitPreviewTitleFont(["12345678901234567890"], (line, fontSize) => line.length * fontSize);
    expect(smaller).toBe(46);
  });
});
