import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptionCommentPreview } from "../components/caption-comment-preview";
import { fitCaptionChannel, wrapCaptionComment } from "./caption-comment-preview";

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
});
