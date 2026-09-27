import { describe, expect, it } from "vitest";
import { isKoreanVideo, isJapaneseVideo, isEnglishVideo } from "./youtube-language";

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

describe("English language detection", () => {
  it.each(["en", "en-US", "en_GB", " EN-au "])("accepts explicit English language %s", code => {
    expect(isEnglishVideo({title:"English video", defaultAudioLanguage:code})).toBe(true);
  });
  it("prefers the audio language, then metadata, and never guesses from Latin text", () => {
    expect(isEnglishVideo({title:"English title",defaultAudioLanguage:"es",defaultLanguage:"en"})).toBe(false);
    expect(isEnglishVideo({title:"한국어 제목",defaultAudioLanguage:"en",defaultLanguage:"ko"})).toBe(false);
    expect(isEnglishVideo({title:"Title",defaultLanguage:"en-GB"})).toBe(true);
    expect(isEnglishVideo({title:"English title"})).toBe(false);
    expect(isEnglishVideo({title:"Hola mundo",defaultLanguage:"es"})).toBe(false);
    expect(isEnglishVideo({title:"Bonjour",defaultLanguage:"eng"})).toBe(false);
  });
});

describe("English filter Korean false-positive guard", () => {
  it.each([
    {title:"범부들은 감히 흉내낼 수 없는 플레이",defaultAudioLanguage:"en-US",defaultLanguage:"ko"},
    {title:"English display title",defaultAudioLanguage:"en",defaultLanguage:"ko-KR"},
    {title:"[MV] Kim Yong Bin(김용빈) _ Only you(당신뿐입니다)",defaultAudioLanguage:"en",defaultLanguage:"en"},
    {title:"헤어진아내가 밥먹자고 부른이유",defaultLanguage:"en"},
    {title:"한국어 제목",defaultAudioLanguage:"en"},
  ])("excludes Korean evidence despite English tags: $title", metadata => {
    expect(isEnglishVideo(metadata)).toBe(false);
  });
  it("retains English metadata without requiring audio or rejecting a localized description", () => {
    expect(isEnglishVideo({title:"Learn English with stories",defaultLanguage:"en"})).toBe(true);
    expect(isEnglishVideo({title:"English Interview",defaultAudioLanguage:"en-US",description:"한국어로 번역된 영상 소개와 설명입니다."})).toBe(true);
  });
});
