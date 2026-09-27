import type { Metadata } from "next";
import { type SiteLocale, siteLocales } from "./i18n/config";
import { localizedHref, isLocalizedPage, localePath } from "./i18n/routing";

export const SITE_URL = "https://www.easycut.co.kr";
export const SITE_NAME = "이지컷";
export const OG_IMAGE_PATH = "/easy-cut-og-1200x630-v3.jpg";
const localizedOgImages = {
  ko: { url: OG_IMAGE_PATH, alt: "이지컷 - 트렌드를 찾고 쇼츠로 선점하세요" },
  en: { url: "/easycut-og-en-v1.jpg", alt: "Easy Cut — Find trending videos. Make standout Shorts." },
  ja: { url: "/easycut-og-ja-v1.jpg", alt: "Easy Cut — 話題の動画を、ショートに。" },
} satisfies Record<SiteLocale, { url: string; alt: string }>;
export const DEFAULT_DESCRIPTION = "유튜브 링크만 입력하면 AI가 하이라이트를 찾아 30~60초 쇼츠로 자동 편집합니다. 제목과 자막도 한 번에 완성하세요.";

type PageMetadataOptions = {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
  locale?: SiteLocale;
  image?: { url: string; alt: string };
};

export function absoluteUrl(path: string) {
  return new URL(path, SITE_URL).toString();
}

export function createPageMetadata({
  title,
  description,
  path,
  type = "website",
  locale = "ko",
  image,
}: PageMetadataOptions): Metadata {
  const url = absoluteUrl(localizedHref(path, locale));
  const ogImage = image ?? localizedOgImages[locale];
  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: url,
      ...(isLocalizedPage(localePath(path).pathname) ? { languages: {
        ...Object.fromEntries(siteLocales.map((language) => [language, absoluteUrl(localizedHref(path, language))])),
        "x-default": absoluteUrl(localizedHref(path, "ko")),
      } } : {}),
    },
    openGraph: {
      type,
      locale: { ko: "ko_KR", en: "en_US", ja: "ja_JP" }[locale],
      url,
      siteName: locale === "ko" ? SITE_NAME : "Easy Cut",
      title,
      description,
      images: [{
        url: ogImage.url,
        width: 1200,
        height: 630,
        alt: ogImage.alt,
      }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage.url],
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
