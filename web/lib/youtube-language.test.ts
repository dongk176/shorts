import { describe, expect, it } from "vitest";
import { isKoreanVideo } from "./youtube-language";

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
