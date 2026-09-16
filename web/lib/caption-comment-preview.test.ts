import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptionCommentPreview } from "../components/caption-comment-preview";
import { captionCommentRuns, fitCaptionChannel, layoutCaptionCommentLine, measureCaptionComment, measureCaptionCommentText, wrapCaptionComment } from "./caption-comment-preview";

describe("saved caption previews", () => {
  afterEach(() => vi.unstubAllGlobals());

  function withoutSegmenter() {
    vi.stubGlobal("Intl", Object.assign(Object.create(Intl), { Segmenter: undefined }));
  }

  it("keeps short comments intact and wraps at word boundaries", () => {
    const measure = (text: string) => Array.from(text).length * 10;
    expect(wrapCaptionComment("A short comment", measure, 180)).toEqual(["A short comment"]);
    expect(wrapCaptionComment("One two three four", measure, 110)).toEqual(["One two", "three four"]);
    expect(wrapCaptionComment("One two three four five six", measure, 110)).toEqual(["One two", "three four…"]);
  });
  it("keeps emoji sequences together when shortening a long comment", () => {
    const emoji = "👨‍👩‍👧‍👦";
    expect(wrapCaptionComment(emoji.repeat(6), (text) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length * 40, 100))
      .toEqual([emoji.repeat(2), `${emoji}…`]);
  });
  it("counts emoji as Unicode characters when choosing a word boundary", () => {
    const prefix = "🎉".repeat(9);
    expect(wrapCaptionComment(`${prefix} ${"가".repeat(60)}`, (text) => Array.from(text).length * 10, 250))
      .toEqual([`${prefix} ${"가".repeat(15)}`, `${"가".repeat(24)}…`]);
  });
  it.each([
    ["ko", "긴 댓글도 편집 화면에서 정상적으로 표시되어야 합니다. ".repeat(4)],
    ["en", "A long comment should still appear in the editor preview. ".repeat(4)],
    ["ja", "長いコメントも編集画面で正しく表示される必要があります。".repeat(4)],
  ] as const)("renders long %s comments without Segmenter", (outputLanguage, text) => {
    const measure = (value: string) => Array.from(value).length * 35;
    const expected = wrapCaptionComment(text, measure);
    withoutSegmenter();
    expect(wrapCaptionComment(text, measure)).toEqual(expected);
    const html = renderToStaticMarkup(createElement(CaptionCommentPreview, {
      outputLanguage,
      theme: "dark",
      comment: { id: "c1", text, nickname: "Viewer", initial: "V", ageLabel: "1d", likeCount: 20, avatarColor: "#2674C8", startSeconds: 0, endSeconds: 5 },
    }));
    expect(html).toContain("data-caption-comment-preview");
    expect(html).toContain("…");
  });
  it.each(["👨‍👩‍👧‍👦", "👍🏽", "🇰🇷", "1️⃣", "e\u0301", "か\u3099", "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}"])(
    "keeps %s together without Segmenter", (unit) => {
      const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      const measure = (value: string) => Array.from(segmenter.segment(value)).length * 40;
      withoutSegmenter();
      expect(wrapCaptionComment(unit.repeat(6), measure, 100)).toEqual([unit.repeat(2), `${unit}…`]);
    },
  );
  it("shrinks a long channel and its avatar together without removing the name", () => {
    const name = "International Mathematics and Science Academy";
    const result = fitCaptionChannel(name, 42, (text, size) => text.length * size / 2);
    expect(result.text).toBe(name);
    expect(result.fontSize).toBe(30);
    expect(result.iconSize).toBe(38);
    expect(result.gap).toBe(12);
    expect(fitCaptionChannel("Easy Cut", 42, (text, size) => text.length * size / 2)).toMatchObject({ fontSize: 42, iconSize: 52 });
  });
  it.each([false, true])("uses the renderer's emoji widths regardless of system emoji font (fallback=%s)", (fallback) => {
    if (fallback) withoutSegmenter();
    const text = "🎉".repeat(35);
    for (const nativeWidth of [25, 35, 50]) {
      const measure = (value: string) => measureCaptionComment(value, (run) => Array.from(run).length * nativeWidth);
      expect(wrapCaptionComment(text, measure)).toEqual(["🎉".repeat(22), "🎉".repeat(13)]);
    }
    expect(captionCommentRuns("123 © ❤️ 👍🏽 🇰🇷 👨‍👩‍👧‍👦 1️⃣"))
      .toEqual([
        { text: "123 © ", emoji: false },
        ...["❤️", "👍🏽", "🇰🇷", "👨‍👩‍👧‍👦", "1️⃣"].flatMap((text, index) => [
          ...(index ? [{ text: " ", emoji: false }] : []), { text, emoji: true },
        ]),
      ]);
  });
  it("retains plain text shaping while positioning emoji at the renderer advance", () => {
    const measure = vi.fn((value: string) => value === "AV" ? 38 : 10);
    expect(layoutCaptionCommentLine("AV🎉 ", measure)).toEqual([
      { text: "AV", emoji: false, x: 0, width: 38 },
      { text: "🎉", emoji: true, x: 38, width: 40.25 },
      { text: " ", emoji: false, x: 78.25, width: 10 },
    ]);
    expect(measure.mock.calls).toEqual([["AV"], [" "]]);
  });
  it("uses the pinned font's space advance when the browser substitutes a wider space", () => {
    const browserMeasure = (text: string) => text === "Great" ? 88.2 : text.length * 9.8;
    expect(measureCaptionCommentText(" Great", browserMeasure)).toBeCloseTo(96.04);
    expect(measureCaptionCommentText("Great Great", browserMeasure)).toBeCloseTo(184.24);
  });
  it("uses explicit word spaces for fonts whose browser space differs from the renderer", () => {
    const name = "International Mathematics and Science Academy";
    const measure = (text: string, size: number) => text.replaceAll(" ", "").length * size * 0.54;
    expect(fitCaptionChannel(name, 42, measure).fontSize).toBe(32);
    expect(fitCaptionChannel(name, 42, measure, 0.29)).toMatchObject({
      text: name, fontSize: 30, wordSpacePx: 8.7,
    });
  });
});
