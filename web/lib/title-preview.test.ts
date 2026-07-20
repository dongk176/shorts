import { describe, expect, it } from "vitest";
import {
  fitPreviewTitleFont,
  titleLineBackground,
  titleLineColor,
  wrapPreviewTitle,
} from "./title-preview";

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

  it("uses the second-line background and text colors for both full-vertical lines", () => {
    expect(titleLineBackground(0, true, "#000000", "#E32626")).toBe("#E32626");
    expect(titleLineBackground(1, true, "#000000", "#E32626")).toBe("#E32626");
    expect(titleLineColor(0, true, "#FFFFFF", "#F04444")).toBe("#F04444");
    expect(titleLineColor(1, true, "#FFFFFF", "#F04444")).toBe("#F04444");
    expect(titleLineBackground(1, true, "#000000", null)).toBe("#000000");
  });

  it("preserves the existing accent-only background outside overlay mode", () => {
    expect(titleLineBackground(0, false, "#000000", "#E32626")).toBeNull();
    expect(titleLineBackground(1, false, "#000000", "#E32626")).toBe("#E32626");
    expect(titleLineColor(0, false, "#FFFFFF", "#F04444")).toBe("#FFFFFF");
    expect(titleLineColor(1, false, "#FFFFFF", "#F04444")).toBe("#F04444");
  });

  it("keeps the first paper line primary-colored in full-vertical mode", () => {
    expect(titleLineColor(0, true, "#111111", "#D52B2B", true)).toBe("#111111");
    expect(titleLineColor(1, true, "#111111", "#D52B2B", true)).toBe("#D52B2B");
  });
});
