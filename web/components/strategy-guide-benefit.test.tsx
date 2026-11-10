import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StrategyGuideBenefit } from "./strategy-guide-benefit";
import { I18nProvider } from "@/lib/i18n/provider";
import { messagesByLocale } from "@/lib/i18n/messages";
import { libraryGuideSlugs } from "@/lib/shorts-guides/catalog";
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({}) }));

describe("pricing workbook benefit", () => {
  it.each(["en", "ja"] as const)("shows the full catalog and language limitation in %s", locale => {
    const html = renderToStaticMarkup(<I18nProvider locale={locale} messages={messagesByLocale[locale]}><StrategyGuideBenefit /></I18nProvider>);
    expect(html).toContain(locale === "en" ? `${libraryGuideSlugs.length} workbooks` : `実践ブック${libraryGuideSlugs.length}冊`);
    expect(html).toContain(locale === "en" ? "Korean-only PDFs" : "韓国語のみ");
    expect(html).toContain(locale === "en" ? "/en/shorts-monetization#guide-library" : "/jp/shorts-monetization#guide-library");
    expect(html).not.toMatch(/[가-힣]/);
  });
});
