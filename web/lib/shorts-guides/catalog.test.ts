import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyticsGuide, guideCoverSrc, guidePdfLocale, guideSlugs, libraryGuideSlugs } from "./catalog";

describe("expanded guide collection", () => {
  it("ships private Korean PDFs and covers for every UI language", () => {
    for (const slug of ["after-work", "views-to-income", "weekend-shorts"] as const) {
      expect(libraryGuideSlugs).toContain(slug);
      for (const locale of ["ko", "en", "ja"] as const) {
        expect(guidePdfLocale(slug, locale)).toBe("ko");
        const cover = guideCoverSrc(slug, locale).split("?")[0];
        expect(existsSync(path.join(process.cwd(), "public", cover))).toBe(true);
      }
      const file = readFileSync(path.join(process.cwd(), "private", "shorts-guides", "ko", `${slug}.pdf`));
      expect(file.subarray(0, 5).toString()).toBe("%PDF-");
    }
  });
  it("preserves the existing analytics database allowlist", () => {
    for (const slug of ["after-work", "views-to-income", "weekend-shorts"] as const) {
      expect(analyticsGuide(slug)).toBeUndefined();
    }
    for (const slug of guideSlugs) expect(analyticsGuide(slug)).toBe(slug);
  });
});
