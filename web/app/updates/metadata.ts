import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/seo";
import type { UpdatePost } from "./data";

export const UPDATES_REVISED_AT = "2026-10-01";
export function updatesMetadata(post?: UpdatePost, page = 1): Metadata {
  const title = post ? `${post.title} | 업데이트 | 이지컷` : `업데이트${page > 1 ? ` ${page}페이지` : ""} | 이지컷`;
  const description = post?.summary ?? "이지컷의 새 기능과 개선 소식. 실제 화면으로 만나는 더 편리한 쇼츠 제작.";
  const url = absoluteUrl(post ? `/updates/${post.slug}` : `/updates${page > 1 ? `?page=${page}` : ""}`);
  const images = [{ url: absoluteUrl(post ? (post.shot?.src ?? `/updates/${post.image}.jpg`) : "/easy-cut-og-1200x630-v3.jpg"), alt: post?.title ?? "이지컷 업데이트" }];
  return {
    title: { absolute: title }, description, alternates: { canonical: url }, robots: { index: true, follow: true },
    openGraph: { title, description, url, locale: "ko_KR", siteName: "이지컷", images,
      ...(post ? { type: "article" as const, publishedTime: post.date, modifiedTime: post.date } : { type: "website" as const }) },
    twitter: { card: "summary_large_image", title, description, images },
  };
}
