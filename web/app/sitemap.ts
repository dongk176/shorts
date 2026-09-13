import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";
import { TEAM_PAGE_VISIBLE } from "@/lib/site-visibility";
import { blogPosts } from "@/lib/blog";

const publicRoutes = [
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
    .map(({ path, changeFrequency, priority }) => ({
      url: absoluteUrl(path),
      changeFrequency,
      priority,
    }));
  return [...pages, ...blogPosts.map((post) => ({
    url: absoluteUrl(`/blog/${post.slug}`),
    lastModified: post.updatedAt,
    changeFrequency: "monthly" as const,
    priority: 0.7,
    images: [absoluteUrl(post.cover.src)],
  }))];
}
