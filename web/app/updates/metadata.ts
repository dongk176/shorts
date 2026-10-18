import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/seo";
import type { UpdatePost } from "./data";
import type { SiteLocale } from "@/lib/i18n/config";
import { localizedHref } from "@/lib/i18n/routing";
import { updateCopy } from "./copy";

export const UPDATES_REVISED_AT = "2026-10-18";
export function updatesMetadata(post?: UpdatePost, page = 1, locale: SiteLocale = "ko"): Metadata {
  const c = updateCopy(locale);
  const title = post ? `${post.title} | ${c.updates} | ${c.brand}` : `${c.updates}${page > 1 ? ` ${c.page(page)}` : ""} | ${c.brand}`;
  const description = post?.summary ?? c.description;
  const path = post ? `/updates/${post.slug}` : `/updates${page > 1 ? `?page=${page}` : ""}`;
  const url = absoluteUrl(localizedHref(path, locale));
  const images = [{ url: absoluteUrl(post ? (post.shot?.src ?? `/updates/${post.image}.jpg`) : "/easy-cut-og-1200x630-v3.jpg"), alt: post?.title ?? `${c.brand} ${c.updates}` }];
  return {
    title: { absolute: title }, description, alternates: { canonical: url, languages: Object.fromEntries((["ko", "en", "ja"] as const).map(l => [l, absoluteUrl(localizedHref(path, l))])) }, robots: { index: true, follow: true },
    openGraph: { title, description, url, locale: { ko: "ko_KR", en: "en_US", ja: "ja_JP" }[locale], siteName: c.brand, images,
      ...(post ? { type: "article" as const, publishedTime: post.date, modifiedTime: post.date } : { type: "website" as const }) },
    twitter: { card: "summary_large_image", title, description, images },
  };
}
