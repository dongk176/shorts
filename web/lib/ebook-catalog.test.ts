import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pricingEbooks, ebookPreviewSrc, ebookRelativePdfPath } from "./ebook-catalog";
import { downloadableEbookSlugs } from "./ebook-entitlements";

describe("pricing ebook editions", () => {
  it("offers exactly the entitled books with a complete private edition and previews in each language", () => {
    expect(pricingEbooks.map((b) => b.slug)).toEqual([...downloadableEbookSlugs]);
    for (const book of pricingEbooks) {
      for (const locale of ["ko", "en", "ja"] as const) {
        expect(book.titles[locale]).toBeTruthy();
        const file = path.join(process.cwd(), "private/ebooks", ebookRelativePdfPath(book.slug, locale));
        expect(readFileSync(file).subarray(0, 5).toString()).toBe("%PDF-");
        for (const page of [1, 2, 3, 4]) {
          const preview = ebookPreviewSrc(book.slug, page, locale).split("?")[0];
          expect(existsSync(path.join(process.cwd(), "public", preview))).toBe(true);
        }
        if (locale !== "ko") {
          expect(ebookPreviewSrc(book.slug, 1, locale)).toContain(`/${locale}/`);
          expect(book.titles[locale]).not.toMatch(/[가-힣]/);
        }
      }
    }
  });
});
