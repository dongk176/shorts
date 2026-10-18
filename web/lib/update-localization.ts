import { updateDraftSchema, type UpdateContent, type UpdateShot } from "./update-content";
import type { SiteLocale } from "./i18n/config";

// Only reader-facing text passes through translation. Addresses, dates, assets,
// layout and publication metadata always come from the original document.
export function mapUpdateText(post: UpdateContent, text: (value: string) => string): UpdateContent {
 const shot = (s: UpdateShot): UpdateShot => ({ ...s, alt: text(s.alt), annotations: s.annotations.map(a => ({ ...a, label: text(a.label) })) });
 const source = { ...post };
 delete source.translations;
 return { ...source, title: text(post.title), summary: text(post.summary), topic: text(post.topic), cover: text(post.cover),
  changes: post.changes.map(text), steps: post.steps.map(text), ...(post.shot ? { shot: shot(post.shot) } : {}),
  ...(post.blocks ? { blocks: post.blocks.map(b => {
   if (b.type === "text") return { ...b, heading: text(b.heading), eyebrow: text(b.eyebrow), paragraphs: b.paragraphs.map(text) };
   if (b.type === "image") return { ...b, heading: text(b.heading), description: text(b.description), shot: shot(b.shot) };
   if (b.type === "steps") return { ...b, heading: text(b.heading), items: b.items.map(text) };
   return b;
  }) } : {}),
 };
}
export function updateSourceTexts(post: UpdateContent): string[] {
 const texts = new Set<string>();
 mapUpdateText(post, value => { if (value.trim()) texts.add(value); return value; });
 return [...texts];
}
export function missingUpdateTexts(post: UpdateContent, locale: "en" | "ja"): string[] {
 const dictionary = post.translations?.[locale];
 return updateSourceTexts(post).filter(s => !dictionary || !Object.hasOwn(dictionary, s) || !dictionary[s].trim());
}
export function localizeUpdate(post: UpdateContent, locale: SiteLocale): UpdateContent | null {
 if (locale === "ko") return mapUpdateText(post, value => value);
 if (missingUpdateTexts(post, locale).length) return null;
 const parsed = updateDraftSchema.safeParse(mapUpdateText(post, s => s.trim() ? post.translations![locale][s] : s));
 return parsed.success ? parsed.data : null;
}
