import { describe, expect, it } from "vitest";
import { subtitleTranslationOutcome, subtitleTranslationNotice } from "./subtitle-translation-outcome";

describe("subtitle translation outcome", () => {
  it("keeps old projects unchanged and ignores unrelated snapshot shapes", () => {
    for (const value of [null, {}, { origin: "unified-template-v5" }, { translationOutcome: { status: "unavailable" } }]) {
      expect(subtitleTranslationOutcome(value)).toBeNull();
    }
  });
  it("persists the failure notice through a snapshot round trip", () => {
    const snapshot = { origin: "unified-template-v5", translationOutcome: {
      policy: "translated-basic-v1", status: "unavailable", contextLimited: false,
    } };
    const value = subtitleTranslationOutcome(JSON.parse(JSON.stringify(snapshot)));
    expect(value?.status).toBe("unavailable");
    for (const locale of ["ko", "en", "ja"]) expect(subtitleTranslationNotice(value, locale)).toBeTruthy();
    expect(subtitleTranslationNotice(value, "ko")).toContain("영상 재생·다운로드");
  });
  it("distinguishes unavailable margins from missing clip captions", () => {
    const ready = { policy: "translated-basic-v1", status: "ready", contextLimited: false } as const;
    expect(subtitleTranslationNotice(ready, "ko")).toBeNull();
    expect(subtitleTranslationNotice({ ...ready, contextLimited: true }, "ko")).toContain("번역된 내용은 유지");
  });
});


it("preserves partial subtitles and their notice across reloads in every UI language", () => {
  const snapshot = { translationOutcome: {
    policy: "translated-basic-v1", status: "ready", contextLimited: true, partial: true,
  } };
  const outcome = subtitleTranslationOutcome(JSON.parse(JSON.stringify(snapshot)));
  expect(outcome?.partial).toBe(true);
  for (const locale of ["ko", "en", "ja"]) {
    expect(subtitleTranslationNotice(outcome, locale)).toBeTruthy();
  }
  expect(subtitleTranslationNotice(outcome, "ko")).toContain("번역된 내용은 유지");
});
