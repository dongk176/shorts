import type { MetadataRoute } from "next";
import { siteLocales } from "@/lib/i18n/config";
import { localizedHref } from "@/lib/i18n/routing";
import { absoluteUrl } from "@/lib/seo";
import { TEAM_PAGE_VISIBLE } from "@/lib/site-visibility";
import { updates } from "./updates/data";
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

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = publicRoutes
    .filter(({ path }) => TEAM_PAGE_VISIBLE || path !== "/team")
    .flatMap(({ path, changeFrequency, priority }) => siteLocales.map((locale) => ({
      url: absoluteUrl(localizedHref(path, locale)),
      alternates: { languages: Object.fromEntries(siteLocales.map((language) => [language, absoluteUrl(localizedHref(path, language))])) },
      changeFrequency,
      priority,
    })));
  return [...pages, { url: absoluteUrl("/updates"), changeFrequency: "weekly" as const, priority: 0.7 }, ...updates.map((post) => ({ url: absoluteUrl(`/updates/${post.slug}`), changeFrequency: "monthly" as const, priority: 0.6 })), ...publishedBlogPosts().map((post) => ({
    url: absoluteUrl(`/blog/${post.slug}`),
    lastModified: post.updatedAt,
    changeFrequency: "monthly" as const,
    priority: 0.7,
    images: [absoluteUrl(post.cover.src)],
  }))];
}
