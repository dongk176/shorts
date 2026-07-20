import type { Metadata } from "next";

export const SITE_URL = "https://www.easycut.co.kr";
export const SITE_NAME = "이지컷(Easy Cut)";
export const OG_IMAGE_PATH = "/easy-cut-og-1200x630-v2.png";
export const DEFAULT_DESCRIPTION = "유튜브 링크만 입력하면 AI가 하이라이트를 찾아 30~60초 쇼츠로 자동 편집합니다. 제목과 자막도 한 번에 완성하세요.";

type PageMetadataOptions = {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
};

export function absoluteUrl(path: string) {
  return new URL(path, SITE_URL).toString();
}

export function createPageMetadata({
  title,
  description,
  path,
  type = "website",
}: PageMetadataOptions): Metadata {
  const url = absoluteUrl(path);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: {
      type,
      locale: "ko_KR",
      url,
      siteName: SITE_NAME,
      title,
      description,
      images: [{
        url: OG_IMAGE_PATH,
        width: 1200,
        height: 630,
        alt: "이지컷 - 트렌드를 찾고 쇼츠로 선점하세요",
      }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [OG_IMAGE_PATH],
    },
  };
}

export function createNoIndexMetadata(title: string, description: string): Metadata {
  return {
    title: { absolute: `${title} | 이지컷` },
    description,
    robots: { index: false, follow: false, nocache: true },
  };
}
