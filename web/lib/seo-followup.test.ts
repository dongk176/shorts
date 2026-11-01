import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { comparisonPricing } from "./comparison-pricing";
import { createUiText } from "./i18n/ui-text";
import { updatesMetadata } from "../app/updates/metadata";
import { updates } from "../app/updates/data";
import { updatePage, UPDATE_PAGE_SIZE } from "../app/updates/pagination";
describe("public multilingual pricing", () => {
  it("uses the public currency and preserves term totals", () => {
    expect(comparisonPricing("en", true)[0].priceLines[0]).toContain("$3.99");
    expect(comparisonPricing("ja", true)[0].priceLines[0]).toContain("750");
    expect(comparisonPricing("ko", false)[0].priceLines[0]).toContain("19,900");
    expect(comparisonPricing("en", true)[1].priceLines[0]).toContain("$44.97 for 3 months");
    expect(JSON.stringify(comparisonPricing("ja", true).map(p => p.priceLines))).not.toContain("원");
    expect(comparisonPricing("en", false)).toEqual([]);
  });
  it("translates all literal comparison-page copy", () => {
    const source = readFileSync(new URL("../app/compare/ai-shorts-tools/page.tsx", import.meta.url), "utf8");
    const phrases = [...source.matchAll(/ui\("([^"\n]+)"\)/g)].map(match => match[1]);
    for (const locale of ["en", "ja"] as const) {
      const ui = createUiText(locale);
      for (const phrase of phrases) expect(ui(phrase), phrase).not.toMatch(/[가-힣]/);
    }
  });
  it("translates new public comparison and template copy", () => {
    for (const locale of ["en", "ja"] as const) {
      const ui = createUiText(locale);
      for (const phrase of ["다양한 쇼츠 템플릿", "다양한 템플릿·자막 스타일", "월 500·1,500·5,000 크레딧", "영상 길이·기능별 크레딧"]) expect(ui(phrase)).not.toMatch(/[가-힣]/);
    }
  });
});
describe("crawlable update archive", () => {
  it("paginates every article once and rejects invalid page addresses", () => {
    const { totalPages } = updatePage(undefined, updates.length)!;
    const slugs = [updates[0].slug];
    for (let page = 1; page <= totalPages; page++) slugs.push(...updates.slice(1).slice((page - 1) * UPDATE_PAGE_SIZE, page * UPDATE_PAGE_SIZE).map(p => p.slug));
    expect(slugs).toEqual(updates.map(p => p.slug));
    for (const invalid of ["0", "-1", "1.2", "abc", "999", ["1", "2"]]) expect(updatePage(invalid, updates.length)).toBeNull();
  });
  it("shares each article and archive page using its own identity", () => {
    for (const post of updates) {
      const m = updatesMetadata(post);
      expect(m.openGraph).toMatchObject({ title: expect.stringContaining(post.title), url: `https://www.easycut.co.kr/updates/${post.slug}`, description: post.summary });
    }
    expect(updatesMetadata(undefined, 2).alternates?.canonical).toBe("https://www.easycut.co.kr/updates?page=2");
  });
});
