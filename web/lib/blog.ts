import "server-only";
import postsData from "@/content/blog/posts.json";
import { absoluteUrl, SITE_URL } from "@/lib/seo";
import { publishedPosts } from "@/lib/blog-publication";

export type BlogImage = { type: "image"; src: string; alt: string; caption: string; width: number; height: number };
export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  cover: BlogImage;
  blocks: ({ type: "html"; html: string } | BlogImage)[];
  sources: { label: string; url: string }[];
  publishedAt: string;
  updatedAt: string;
  verifiedAt: string;
  readingMinutes: number;
  toc: { id: string; title: string }[];
  naverUrl?: string;
  revisionNote?: string;
};

export const BLOG_TITLE = "이지컷 블로그";
export const BLOG_DESCRIPTION = "쇼츠를 시작하는 방법부터 브이로그·인터뷰 활용법, AI 자막과 댓글 템플릿, 요금 비교까지. 이지컷 운영팀이 직접 확인한 화면과 제작 기록으로 알려드려요.";
export const BLOG_CATEGORIES = ["전체", "시작하기", "활용 가이드", "사용 가이드", "비교·요금", "제작 노트"];
const allBlogPosts: BlogPost[] = (postsData as BlogPost[]).slice().reverse();
export const publishedBlogPosts = (now = Date.now()) => publishedPosts(allBlogPosts, now);
export const blogPost = (slug: string, now = Date.now()) => publishedBlogPosts(now).find((post) => post.slug === slug);
export const blogPath = (slug: string) => `/blog/${slug}`;
export function blogDate(date: string) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(date));
}

export function blogArticleData(post: BlogPost) {
  const url = absoluteUrl(blogPath(post.slug));
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${url}#article`,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    headline: post.title,
    description: post.description,
    image: { "@type": "ImageObject", url: absoluteUrl(post.cover.src), width: post.cover.width, height: post.cover.height },
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    inLanguage: "ko-KR",
    isAccessibleForFree: true,
    articleSection: post.category,
    keywords: post.tags,
    author: { "@type": "Organization", name: "이지컷 운영팀", url: `${SITE_URL}/blog#editorial` },
    publisher: { "@id": `${SITE_URL}/#organization` },
    isPartOf: { "@type": "Blog", "@id": `${SITE_URL}/blog#blog`, name: BLOG_TITLE },
    citation: post.sources.map((source) => source.url),
  };
}

export function blogBreadcrumbData(post?: BlogPost) {
  const items = [{ name: "이지컷", item: SITE_URL }, { name: BLOG_TITLE, item: `${SITE_URL}/blog` }];
  if (post) items.push({ name: post.title, item: absoluteUrl(blogPath(post.slug)) });
  return {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, ...item })),
  };
}
