import { describe, expect, it, vi } from "vitest";
import { createNoIndexMetadata, createPageMetadata } from "./seo";
import { localizedSeoCopy, searchLocalesForPath, seoCopyForPath } from "./seo-localization";
import { applicationIdentity, localizedArticle, localizedBreadcrumb, publicMonthlyOffer, websiteStructuredData } from "./seo-structured-data";
import sitemap from "../app/sitemap";

vi.mock("./update-store", () => ({ publishedUpdates: vi.fn(async () => []) }));
vi.mock("server-only", () => ({}));
vi.mock("./i18n/server", () => ({ getRequestLocale: vi.fn(async () => "ja") }));

const metadataFor = (path: string, locale: "ko" | "en" | "ja") => createPageMetadata({ title: "Page", description: "Description", path, locale });

describe("search language consistency", () => {
  it("does not fall back to Korean for dedicated English or Japanese page copy", async () => {
    const { createLocalizedPageMetadata } = await import("./i18n/metadata");
    for (const [path, locales] of Object.entries(localizedSeoCopy)) {
      for (const locale of ["en", "ja"] as const) {
        expect(locales[locale].title).not.toMatch(/[가-힣]/);
        expect(locales[locale].description).not.toMatch(/[가-힣]/);
        expect(seoCopyForPath(path, locale)).toEqual(locales[locale]);
      }
      expect(seoCopyForPath(path, "ko")).toBeUndefined();
      const result = await createLocalizedPageMetadata({ path, title: "변경된 제목", description: "새로운 한국어 설명" });
      expect(result.title).toEqual({ absolute: locales.ja.title });
      expect(result.description).toBe(locales.ja.description);
    }
  });
  it.each(["/blog", "/blog/example", "/guidebook", "/enterprise/purchase-terms", "/enterprise/refund-policy"])("keeps untranslated %s out of foreign search", (path) => {
    expect(searchLocalesForPath(path)).toEqual(["ko"]);
    expect(metadataFor(path, "ko").robots).toBeUndefined();
    for (const locale of ["en", "ja"] as const) {
      const metadata = metadataFor(path, locale);
      expect(metadata.robots).toMatchObject({ index: false, follow: true, googleBot: { index: false } });
      expect(metadata.alternates?.languages).toEqual({});
    }
  });
  it("keeps private pages and archived purchase terms out of search", () => {
    expect(createNoIndexMetadata("Project", "Private").robots).toMatchObject({ index: false, googleBot: { index: false } });
    expect(metadataFor("/purchase-terms/versions/7", "ko").robots).toMatchObject({ index: false, googleBot: { index: false } });
  });
  it("publishes reciprocal language alternatives only for translated sitemap entries", async () => {
    const pages = await sitemap();
    const urls = new Set(pages.map(page => page.url));
    for (const page of pages) {
      for (const url of Object.values(page.alternates?.languages ?? {})) expect(urls.has(String(url))).toBe(true);
      expect(page.url).not.toMatch(/\/(en|jp)\/(blog|guidebook|enterprise\/(purchase-terms|refund-policy))/);
    }
    expect(urls.has("https://www.easycut.co.kr/jp/pricing")).toBe(true);
    expect(urls.has("https://www.easycut.co.kr/guidebook")).toBe(true);
    expect(pages.find(p => p.url === "https://www.easycut.co.kr/jp/pricing")?.alternates?.languages).toMatchObject({ en: "https://www.easycut.co.kr/en/pricing", ja: "https://www.easycut.co.kr/jp/pricing", "x-default": "https://www.easycut.co.kr/pricing" });
  });
  it("matches public prices without changing units or advertising unavailable foreign pricing", () => {
    expect(publicMonthlyOffer("ko", false)).toMatchObject({ price: "9900", priceCurrency: "KRW" });
    expect(publicMonthlyOffer("en", true)).toMatchObject({ price: "3.99", priceCurrency: "USD", url: "https://www.easycut.co.kr/en/pricing" });
    expect(publicMonthlyOffer("ja", true)).toMatchObject({ price: "750", priceCurrency: "JPY", url: "https://www.easycut.co.kr/jp/pricing" });
    expect(publicMonthlyOffer("en", false)).toBeUndefined();
    expect(publicMonthlyOffer("ja", false)).toBeUndefined();
  });
  it("ties Japanese articles and breadcrumbs to their Japanese page", () => {
    expect(localizedArticle("ja", "/ai-shorts-maker", "作成", "説明", "2026-01-01", "2026-09-30")).toMatchObject({ inLanguage: "ja-JP", mainEntityOfPage: "https://www.easycut.co.kr/jp/ai-shorts-maker" });
    const breadcrumb = localizedBreadcrumb("ja", "/ai-shorts-maker", "作成");
    expect(breadcrumb.itemListElement.map(item => item.item)).toEqual(["https://www.easycut.co.kr/jp", "https://www.easycut.co.kr/jp/ai-shorts-maker"]);
    expect(applicationIdentity("ja").name).toContain("イージーカット");
    expect(websiteStructuredData("ko")["@graph"][1].name).toBe("이지컷");
  });
});
