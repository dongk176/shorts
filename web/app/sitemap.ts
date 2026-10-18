import { UPDATES_REVISED_AT } from "./updates/metadata";
import type { MetadataRoute } from "next";
import { searchLocalesForPath } from "@/lib/seo-localization";
import { localizedHref } from "@/lib/i18n/routing";
import { absoluteUrl } from "@/lib/seo";
import { TEAM_PAGE_VISIBLE } from "@/lib/site-visibility";
import { publishedUpdates } from "@/lib/update-store";
import { publishedBlogPosts } from "@/lib/blog";

export const dynamic = "force-dynamic";

const publicRoutes = [
  { path: "/shorts-monetization", changeFrequency: "monthly", priority: 0.8 },
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/blog", changeFrequency: "daily", priority: 0.8 },
  { path: "/ai-shorts-maker", changeFrequency: "monthly", priority: 0.9 },
  { path: "/guidebook", changeFrequency: "monthly", priority: 0.8 },
  { path: "/templates", changeFrequency: "monthly", priority: 0.8 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.8 },
  { path: "/popular", changeFrequency: "daily", priority: 0.8 },
  { path: "/easycut-private", changeFrequency: "weekly", priority: 0.8 },
  { path: "/compare/ai-shorts-tools", changeFrequency: "monthly", priority: 0.8 },
  { path: "/team", changeFrequency: "monthly", priority: 0.6 },
  { path: "/faq", changeFrequency: "monthly", priority: 0.6 },
  { path: "/support", changeFrequency: "monthly", priority: 0.4 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.2 },
  { path: "/purchase-terms", changeFrequency: "yearly", priority: 0.2 },
  { path: "/refund", changeFrequency: "yearly", priority: 0.2 },
  { path: "/enterprise/purchase-terms", changeFrequency: "yearly", priority: 0.2 },
  { path: "/enterprise/refund-policy", changeFrequency: "yearly", priority: 0.2 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.2 },
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const updates = await publishedUpdates();
  const pages = publicRoutes
    .filter(({ path }) => TEAM_PAGE_VISIBLE || path !== "/team")
    .flatMap(({ path, changeFrequency, priority }) => searchLocalesForPath(path).map((locale) => ({
      url: absoluteUrl(localizedHref(path, locale)),
      ...(searchLocalesForPath(path).length > 1 ? { alternates: { languages: {
        ...Object.fromEntries(searchLocalesForPath(path).map((language) => [language, absoluteUrl(localizedHref(path, language))])),
        "x-default": absoluteUrl(localizedHref(path, "ko")),
      } } } : {}),
      ...(["/", "/ai-shorts-maker", "/compare/ai-shorts-tools", "/popular"].includes(path) ? { lastModified: "2026-10-01" } : {}),
      changeFrequency,
      priority,
    })));
  const updatePages = [{ path: "/updates", date: UPDATES_REVISED_AT }, ...updates.map(post => ({ path: `/updates/${post.slug}`, date: post.date }))].flatMap(({ path, date }) => (["ko", "en", "ja"] as const).map(locale => ({
    url: absoluteUrl(localizedHref(path, locale)), lastModified: date, changeFrequency: "weekly" as const, priority: 0.6,
    alternates: { languages: Object.fromEntries((["ko", "en", "ja"] as const).map(language => [language, absoluteUrl(localizedHref(path, language))])) },
  })));
  return [...pages, ...updatePages, ...publishedBlogPosts().map((post) => ({
    url: absoluteUrl(`/blog/${post.slug}`),
    lastModified: post.updatedAt,
    changeFrequency: "monthly" as const,
    priority: 0.7,
    images: [absoluteUrl(post.cover.src)],
  }))];
}
