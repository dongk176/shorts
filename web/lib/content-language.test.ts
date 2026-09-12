import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { outputLanguages } from "./contracts";
import {
  commentAgeLabel, commentDuplicateKey, contentLanguages, normalizeOutputLanguage,
  textMatchesLanguage, contentTitleFont,
  commentFontFamily,
} from "./content-language";
import { editorSupportsJapaneseFont, editorUsesJapaneseFont } from "./editor-fonts";
import japaneseFont from "./editor-japanese-font.json";
import { selectRandomFallbackCommentTexts } from "./fallback-comments";

describe("project content language", () => {
  it("ships the same language contract to web and worker", () => {
    const worker = JSON.parse(readFileSync(new URL(
      "../../worker/shorts_worker/content_languages.json", import.meta.url,
    ), "utf8"));
    expect(contentLanguages).toEqual(worker);
    expect(Object.keys(contentLanguages)).toEqual(outputLanguages);
  });

  it.each(outputLanguages)("keeps new comment fallback and metadata in %s", (language) => {
    const comments = selectRandomFallbackCommentTexts(20, [], () => 0, language);
    expect(comments).toHaveLength(20);
    expect(new Set(comments.map(commentDuplicateKey)).size).toBe(20);
    expect(comments.every((text) => textMatchesLanguage(text, language))).toBe(true);
    expect(commentAgeLabel(2, language)).not.toContain("{count}");
    if (language !== "ko") expect(commentAgeLabel(2, language)).not.toContain("개월");
  });

  it("excludes Japanese duplicates without dropping Japanese letters", () => {
    expect(commentDuplicateKey("ｶﾞｯﾂﾎﾟｰｽﾞ！")).toBe(commentDuplicateKey("ガッツポーズ"));
    expect(commentDuplicateKey("ここが気になる")).not.toBe(commentDuplicateKey("先が気になる"));
    const existing = contentLanguages.ja.comments[0];
    expect(selectRandomFallbackCommentTexts(1, [existing + "!!"], () => 0, "ja"))
      .toEqual([contentLanguages.ja.comments[1]]);
    expect(textMatchesLanguage("ｺｺｶﾞｷﾆﾅﾙ", "ja")).toBe(true);
    expect(commentDuplicateKey("CAFÉ")).toBe(commentDuplicateKey("cafe\u0301"));
  });

  it("rejects foreign scripts without pretending to detect all languages", () => {
    expect(textMatchesLanguage("한국어로 쓴 댓글", "en")).toBe(false);
    expect(textMatchesLanguage("An English comment", "ja")).toBe(false);
    expect(textMatchesLanguage("한국어로 쓴 댓글", "ja")).toBe(false);
    expect(textMatchesLanguage("A café worth revisiting", "en")).toBe(true);
    expect(commentAgeLabel(1, "en")).toBe("1 month ago");
    expect(commentAgeLabel(2, "en")).toBe("2 months ago");
    expect(normalizeOutputLanguage(undefined)).toBe("ko");
  });
  it.each(["가", "ㅋ", "\u1100", "\uffa1", "\ua960", "\ud7b0"])("rejects Hangul variant %s in foreign comments", (hangul) => {
    expect(textMatchesLanguage("この場面が気になる" + hangul, "ja")).toBe(false);
    expect(textMatchesLanguage("这个场景很有趣" + hangul, "zh-CN")).toBe(false);
    expect(textMatchesLanguage("This scene is interesting " + hangul, "en")).toBe(false);
    expect(textMatchesLanguage("한국어 댓글 " + hangul, "ko")).toBe(true);
  });
  it("keeps the Japanese title font available in both rendering and later edits", () => {
    const title = contentLanguages.ja.title.join("\n");
    expect(contentTitleFont(title, "pretendard")).toBe("noto-sans-kr");
    expect(contentTitleFont(title, "noto-serif-kr")).toBe("noto-serif-kr");
    expect(contentTitleFont("한국어 제목", "pretendard")).toBe("pretendard");
    expect(contentTitleFont("The Moment You", "pretendard")).toBe("pretendard");
    expect(contentTitleFont("ｶﾀｶﾅ", "godo")).toBe("noto-sans-kr");
  });

  it("uses the new Japanese face only when the assigned worker supports it", () => {
    const title = "左右の対称性\n奥深い世界";
    expect(editorSupportsJapaneseFont(japaneseFont.fontManifestSha256)).toBe(true);
    for (const old of [undefined, null, "b9f530954066e89e95fcd2cfb77db558e68530329d3d1d9db17e4e73c859d486", "0".repeat(64)]) {
      expect(editorSupportsJapaneseFont(old)).toBe(false);
      expect(contentTitleFont(title, "noto-sans-kr", editorSupportsJapaneseFont(old))).toBe("noto-sans-kr");
    }
    expect(contentTitleFont(title, "noto-sans-kr", true)).toBe("noto-sans-jp");
    expect(contentTitleFont("한국어 제목", "pretendard", true)).toBe("noto-sans-jp");
    expect(commentFontFamily("意外と奥が深いね", true)).toContain("Editor Noto Sans JP");
    expect(commentFontFamily("意外と奥が深いね", false)).toBeUndefined();
    expect(commentFontFamily("한국어 댓글", true)).toBeUndefined();
    expect(editorUsesJapaneseFont("ja", japaneseFont.fontManifestSha256, "noto-sans-jp")).toBe(true);
    for (const initial of [undefined, "noto-sans-kr", "noto-serif-kr", "pretendard"]) {
      expect(editorUsesJapaneseFont("ja", japaneseFont.fontManifestSha256, initial)).toBe(false);
    }
    expect(editorUsesJapaneseFont("ko", japaneseFont.fontManifestSha256, "noto-sans-jp")).toBe(false);
    expect(editorUsesJapaneseFont("ja", "0".repeat(64), "noto-sans-jp")).toBe(false);
  });

});
