import { describe, expect, it } from "vitest";
import {
  formatLocale,
  nicepayLanguage,
  normalizeSiteLocale,
  siteLocales,
} from "./config";
import { formatKrw, formatNumber, formatSeoulDate } from "./format";
import { interpolateMessage, messagesByLocale } from "./messages";

describe("site locale", () => {
  it("accepts only supported locales and defaults to Korean", () => {
    expect(siteLocales).toEqual(["ko", "en", "ja"]);
    expect(normalizeSiteLocale("en")).toBe("en");
    expect(normalizeSiteLocale("ja")).toBe("ja");
    expect(normalizeSiteLocale("fr")).toBe("ko");
    expect(normalizeSiteLocale(null)).toBe("ko");
  });

  it("keeps every locale dictionary in key parity", () => {
    const koreanKeys = Object.keys(messagesByLocale.ko).sort();
    expect(Object.keys(messagesByLocale.en).sort()).toEqual(koreanKeys);
    expect(Object.keys(messagesByLocale.ja).sort()).toEqual(koreanKeys);
  });

  it("interpolates named message values", () => {
    expect(interpolateMessage("Base {minutes} min", { minutes: 12 })).toBe("Base 12 min");
    expect(interpolateMessage("{missing}")).toBe("{missing}");
  });

  it("formats numbers, dates, currency and payment language by locale", () => {
    expect(formatLocale("ja")).toBe("ja-JP");
    expect(formatNumber(1234, "en")).toContain("1,234");
    expect(formatKrw(9900, "ko")).toContain("9,900");
    expect(formatSeoulDate("2026-07-21T15:00:00.000Z", "en")).toContain("2026");
    expect(nicepayLanguage("ko")).toBe("KO");
    expect(nicepayLanguage("en")).toBe("EN");
    expect(nicepayLanguage("ja")).toBe("EN");
  });
});
