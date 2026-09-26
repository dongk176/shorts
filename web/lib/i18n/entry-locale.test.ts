import { describe, expect, it } from "vitest";
import { entryLocale } from "./entry-locale";

describe("home entry language", () => {
  it.each([["KR", "ko"], ["JP", "ja"], ["US", "en"], ["FR", "en"], ["BR", "en"], ["TW", "en"]])("maps %s to supported language %s", (country, locale) => {
    expect(entryLocale(undefined, country, "ko-KR")).toBe(locale);
  });
  it.each(["ko", "ja", "en"])("keeps explicit %s regardless of country", (locale) => {
    expect(entryLocale(locale, "JP", "en")).toBe(locale);
  });
  it.each([
    ["en-US;q=0.5,ja-JP;q=0.9", "ja"],
    ["fr-FR,ko-KR;q=0.8,en;q=0.7", "ko"],
    ["ja;q=0,en;q=0.5", "en"],
    ["ja;q=invalid,ko;q=0.8", "ko"],
    ["ja;q=2,en", "en"], ["de-DE", "en"], ["", "ko"],
  ])("falls back to browser preferences %s", (languages, locale) => {
    expect(entryLocale(undefined, null, languages)).toBe(locale);
  });
  it("ignores invalid cookies and unknown country sentinels", () => {
    expect(entryLocale("fr", "JP", "ko")).toBe("ja");
    expect(entryLocale("../../en", "XX", "ja")).toBe("ja");
    expect(entryLocale(undefined, "ZZ", "ko")).toBe("ko");
  });
});
