import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { UpdateArticleView } from "./article-view";
import { UpdatesCatalog } from "./updates-catalog";
import { updateDraftSchema } from "@/lib/update-content";
import { localizeUpdate, updateSourceTexts } from "@/lib/update-localization";
import { readFileSync } from "node:fs";
const post = updateDraftSchema.parse(JSON.parse(readFileSync(new URL("../../../supabase/migrations/202610010100_update_cms.sql", import.meta.url), "utf8").split("$seed$")[1])[0]);
describe("localized public update views", () => {
 it.each(["en", "ja"] as const)("renders %s content, controls and links without Korean reader-facing text", locale => {
  const dictionary = Object.fromEntries(updateSourceTexts(post).map((s, i) => [s, locale === "en" ? `Update text ${i}` : `更新内容 ${i}`]));
  const localized = localizeUpdate({ ...post, translations: { en: dictionary, ja: dictionary } }, locale)!;
  const html = renderToStaticMarkup(<><UpdatesCatalog updates={[localized]} locale={locale}/><UpdateArticleView post={localized} locale={locale}/></>);
  const visible = html.replace(/<[^>]*>/g, "");
  expect(visible).not.toMatch(/[가-힣]/);
  expect(html).toContain(`href="/${locale === "en" ? "en" : "jp"}/updates/${post.slug}"`);
  expect(html).toContain(`href="/${locale === "en" ? "en" : "jp"}/updates"`);
  expect(html).not.toContain('href="/updates');
 });
});
