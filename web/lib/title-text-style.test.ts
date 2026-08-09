import { describe, expect, it } from "vitest";
import type { TitleTextStyle } from "./contracts";
import {
  applyTitleTextStyle,
  codePointOffset,
  defaultTemplateTitleTextStyles,
  rebaseTitleTextStyles,
} from "./title-text-style";

describe("title text selection styles", () => {
  it("converts textarea UTF-16 offsets to Unicode character offsets", () => {
    expect(codePointOffset("A😀한글", 3)).toBe(2);
  });

  it("splits and merges ranges while preserving the other color property", () => {
    const withTextColor = applyTitleTextStyle([], 6, 1, 5, { color: "#00FF00" });
    const withBackground = applyTitleTextStyle(withTextColor, 6, 2, 4, { backgroundColor: "#123456" });

    expect(withBackground).toEqual([
      { start: 1, end: 2, color: "#00FF00" },
      { start: 2, end: 4, color: "#00FF00", backgroundColor: "#123456" },
      { start: 4, end: 5, color: "#00FF00" },
    ]);
  });

  it("clears only the requested property from a selection", () => {
    expect(applyTitleTextStyle([
      { start: 0, end: 3, color: "#FFFFFF", backgroundColor: "#E32626" },
    ], 3, 0, 3, { backgroundColor: null })).toEqual([
      { start: 0, end: 3, color: "#FFFFFF" },
    ]);
  });

  it("converts a template accent background into a second-line style range", () => {
    expect(defaultTemplateTitleTextStyles(
      "첫 줄\n둘째 줄",
      "4:5",
      "#000000",
      "#E32626",
    )).toEqual([{ start: 4, end: 8, backgroundColor: "#E32626" }]);
  });

  it("uses a text background on every title line in full-vertical overlay mode", () => {
    expect(defaultTemplateTitleTextStyles(
      "첫 줄\n둘째 줄",
      "9:16",
      "#000000",
      null,
    )).toEqual([{ start: 0, end: 8, backgroundColor: "#000000" }]);
  });

  it("uses the selected brand color for template-provided title backgrounds", () => {
    expect(defaultTemplateTitleTextStyles(
      "첫 줄\n둘째 줄",
      "4:5",
      "#000000",
      "#E32626",
      "#3B82F6",
    )).toEqual([{
      start: 4,
      end: 8,
      backgroundColor: "#3B82F6",
      color: "#000000",
    }]);
  });

  it("keeps templates without a background transparent outside overlay mode", () => {
    expect(defaultTemplateTitleTextStyles("배경 없음", "4:5", "#000000", null)).toEqual([]);
  });

  it("keeps the first-line color when a second title line is added", () => {
    expect(rebaseTitleTextStyles(
      "첫줄",
      "첫줄\n둘째줄",
      [{ start: 0, end: 2, color: "#FF715E" }],
    )).toEqual([{ start: 0, end: 6, color: "#FF715E" }]);
  });

  it("moves the second-line color range when the first line changes", () => {
    const styles = [{ start: 3, end: 6, color: "#35E6E3" }];
    const inserted = rebaseTitleTextStyles(
      "첫줄\n둘째줄",
      "첫째줄\n둘째줄",
      styles,
    );
    expect(inserted).toEqual([{ start: 4, end: 7, color: "#35E6E3" }]);
    expect(rebaseTitleTextStyles(
      "첫째줄\n둘째줄",
      "첫줄\n둘째줄",
      inserted,
    )).toEqual(styles);
  });

  it("keeps first-line color and background while the second line is replaced", () => {
    expect(rebaseTitleTextStyles(
      "첫 번째 행\n두 번째 행",
      "첫 번째 행\n완전히 바꾼 두 번째 행",
      [
        { start: 0, end: 6, color: "#FF715E", backgroundColor: "#111111" },
        { start: 7, end: 13, color: "#35E6E3", backgroundColor: "#E32626" },
      ],
    )).toEqual([
      { start: 0, end: 6, color: "#FF715E", backgroundColor: "#111111" },
      { start: 7, end: 20, color: "#35E6E3", backgroundColor: "#E32626" },
    ]);
  });

  it("keeps second-line color and background while the first line is replaced", () => {
    expect(rebaseTitleTextStyles(
      "첫 번째 행\n두 번째 행",
      "새로 바꾼 첫 번째 행\n두 번째 행",
      [
        { start: 0, end: 6, color: "#FF715E", backgroundColor: "#111111" },
        { start: 7, end: 13, color: "#35E6E3", backgroundColor: "#E32626" },
      ],
    )).toEqual([
      { start: 0, end: 12, color: "#FF715E", backgroundColor: "#111111" },
      { start: 13, end: 19, color: "#35E6E3", backgroundColor: "#E32626" },
    ]);
  });

  it("preserves the untouched row through repeated Korean input changes", () => {
    const firstLineStyle = {
      start: 0,
      end: 3,
      color: "#FF4D4F",
      backgroundColor: "#111111",
    };
    let title = "첫째줄\n둘째줄";
    let styles: TitleTextStyle[] = [
      firstLineStyle,
      { start: 4, end: 7, color: "#35E6E3" },
    ];
    for (const nextTitle of [
      "첫째줄\n새둘째줄",
      "첫째줄\n새로운둘째줄",
      "첫째줄\n수정한 두 번째 행",
    ]) {
      styles = rebaseTitleTextStyles(title, nextTitle, styles);
      expect(styles[0]).toEqual(firstLineStyle);
      title = nextTitle;
    }
  });
});
