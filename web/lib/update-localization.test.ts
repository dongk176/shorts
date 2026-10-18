import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { localizeUpdate, missingUpdateTexts, updateSourceTexts } from "./update-localization";
import { updateDraftSchema } from "./update-content";
import { localizedHref } from "./i18n/routing";
import { updatesMetadata } from "../app/updates/metadata";
const seed = JSON.parse(readFileSync(new URL("../../supabase/migrations/202610010100_update_cms.sql", import.meta.url), "utf8").split("$seed$")[1]);
const post = updateDraftSchema.parse(seed[0]);
function translated() {
 const dictionary = Object.fromEntries(updateSourceTexts(post).map((s, i) => [s, `Translated ${i}`]));
 return { ...post, translations: { en: dictionary, ja: dictionary } };
}
describe("update translations", () => {
 it("requires complete translations and never silently displays Korean on another language page", () => {
  expect(localizeUpdate(post, "en")).toBeNull();
  expect(localizeUpdate(post, "ko")).toEqual(post);
  expect(localizeUpdate(translated(), "en")?.title).toBe("Translated 0");
 });
 it("invalidates changed text while keeping translations valid for layout-only edits", () => {
  expect(missingUpdateTexts({ ...translated(), title: "새로운 제목" }, "en")).toEqual(["새로운 제목"]);
  expect(localizeUpdate({ ...translated(), title: "새로운 제목" }, "en")).toBeNull();
  expect(localizeUpdate({ ...translated(), readingMinutes: 5 }, "en")?.readingMinutes).toBe(5);
 });
 it("translates all blocks and image descriptions without changing assets, links, dates or geometry", () => {
  for (const original of seed) {
   const p = updateDraftSchema.parse(original);
   const dictionary = Object.fromEntries(updateSourceTexts(p).map((s, i) => [s, `Text ${i}`]));
   const result = localizeUpdate({ ...p, translations: { en: dictionary, ja: dictionary } }, "en")!;
   expect(result).not.toBeNull();
   expect(result).toMatchObject({ slug: p.slug, date: p.date, href: p.href, kind: p.kind, image: p.image });
   expect(result.shot).toMatchObject({ src: p.shot!.src, width: p.shot!.width, cropX: p.shot!.cropX });
   expect(result.blocks?.map(b => b.type)).toEqual(p.blocks?.map(b => b.type));
   expect(updateSourceTexts(result).every(s => !/[가-힣]/.test(s))).toBe(true);
   expect(result.translations).toBeUndefined();
  }
 });
 it("rejects missing and oversized translations", () => {
  const p = translated(); delete p.translations.en[post.title];
  expect(localizeUpdate(p, "en")).toBeNull();
  p.translations.en[post.title] = "x".repeat(161);
  expect(localizeUpdate(p, "en")).toBeNull();
 });
 it("keeps language in article, pagination and navigation URLs, with distinct SEO alternatives", () => {
  expect(localizedHref("/updates/test?page=2#top", "ja")).toBe("/jp/updates/test?page=2#top");
  expect(localizedHref("/jp/updates/test", "en")).toBe("/en/updates/test");
  expect(localizedHref("/api/updates/recent", "en")).toBe("/api/updates/recent");
  const meta = updatesMetadata(localizeUpdate(translated(), "en")!, 1, "en");
  expect(meta.alternates?.canonical).toContain(`/en/updates/${post.slug}`);
  expect(meta.alternates?.languages?.ja).toContain(`/jp/updates/${post.slug}`);
 });
});
