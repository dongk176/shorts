import { describe, expect, it } from "vitest";
import { creatorYouTubeUrl, editCreatorPhone, formatCreatorPhone, YOUTUBE_WEB_URL } from "./creator-input-helpers";

describe("creator platform navigation", () => {
  it("requests the native iPhone and iPad app instead of an in-app web page", () => {
    for (const device of [
      { userAgent: "iPhone KAKAOTALK", platform: "iPhone", maxTouchPoints: 5 },
      { userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5 },
    ]) expect(creatorYouTubeUrl(device)).toBe("vnd.youtube://www.youtube.com/");
  });
  it("targets the Android YouTube package and falls back to its store", () => {
    const url = creatorYouTubeUrl({ userAgent: "Android KAKAOTALK", platform: "Linux arm", maxTouchPoints: 5 });
    expect(url).toContain("intent://www.youtube.com/#Intent;scheme=https;package=com.google.android.youtube;");
    expect(decodeURIComponent(url)).toContain("S.browser_fallback_url=https://play.google.com/store/apps/details?id=com.google.android.youtube;");
  });
  it("keeps desktop web navigation", () => {
    expect(creatorYouTubeUrl({ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 0 })).toBe(YOUTUBE_WEB_URL);
  });
});

describe("creator phone editing", () => {
  it("formats typing, pasted and autofilled Korean mobile numbers", () => {
    expect(["", "010", "0101", "0101234", "0101234567", "01012345678"].map(formatCreatorPhone))
      .toEqual(["", "010", "010-1", "010-1234", "010-1234-567", "010-1234-5678"]);
    expect(formatCreatorPhone("+82 10 1234 5678")).toBe("010-1234-5678");
    expect(formatCreatorPhone("０１０１２３４５６７８")).toBe("010-1234-5678");
    expect(formatCreatorPhone("0111234567")).toBe("011-123-4567");
  });
  it("allows backspace and forward-delete across inserted separators", () => {
    expect(editCreatorPhone("010-1234-5678", "0101234-5678", 3, "deleteContentBackward"))
      .toEqual({ value: "011-234-5678", caret: 2 });
    expect(editCreatorPhone("010-1234-5678", "0101234-5678", 3, "deleteContentForward"))
      .toEqual({ value: "010-2345-678", caret: 3 });
  });
  it("keeps the caret beside the edited digit instead of jumping to the end", () => {
    expect(editCreatorPhone("010-1234-5678", "010-9234-5678", 5, "insertText"))
      .toEqual({ value: "010-9234-5678", caret: 5 });
    expect(editCreatorPhone("010-1234-5678", "", 0, "deleteByCut"))
      .toEqual({ value: "", caret: 0 });
  });
});
