import { describe, expect, it } from "vitest";
import { fitCaptionChannel, wrapCaptionComment } from "./caption-comment-preview";

describe("saved caption previews", () => {
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
