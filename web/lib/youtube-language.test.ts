import { describe, expect, it } from "vitest";
import { isKoreanVideo, isJapaneseVideo } from "./youtube-language";

describe("YouTube Korean-language detection", () => {
  it("accepts Korean audio and metadata language codes", () => {
    expect(isKoreanVideo({ title: "English title", defaultAudioLanguage: "ko-KR" })).toBe(true);
    expect(isKoreanVideo({ title: "English title", defaultLanguage: "ko" })).toBe(true);
  });

  it("uses Korean title and description text when language metadata is missing", () => {
    expect(isKoreanVideo({ title: "오늘의 인기 영상" })).toBe(true);
    expect(isKoreanVideo({
      title: "English title",
      description: "한국어로 제작된 영상의 자세한 설명입니다.",
    })).toBe(true);
  });

  it("does not classify an English video as Korean", () => {
    expect(isKoreanVideo({
      title: "Popular video",
      description: "An English description",
      defaultAudioLanguage: "en-US",
      defaultLanguage: "en",
    })).toBe(false);
  });
});

describe("Japanese language detection", () => {
  it("gives audio language priority over default language and title", () => {
    expect(isJapaneseVideo({ title: "日本語の動画", defaultAudioLanguage: "ko-KR", defaultLanguage: "ja" })).toBe(false);
    expect(isJapaneseVideo({ title: "English title", defaultAudioLanguage: "ja-JP", defaultLanguage: "en" })).toBe(true);
    expect(isJapaneseVideo({ title: "English title", defaultLanguage: "ja" })).toBe(true);
  });
  it("only falls back to two kana when explicit language is absent", () => {
    expect(isJapaneseVideo({ title: "楽しい料理" })).toBe(true);
    expect(isJapaneseVideo({ title: "ｶﾀｶﾅ動画" })).toBe(true);
    expect(isJapaneseVideo({ title: "中文漢字" })).toBe(false);
    expect(isJapaneseVideo({ title: "あ" })).toBe(false);
    expect(isJapaneseVideo({ title: "English", description: "日本語の説明" })).toBe(false);
    expect(isJapaneseVideo({ title: "楽しい料理", defaultLanguage: "en" })).toBe(false);
  });
});
