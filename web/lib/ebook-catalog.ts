import type { SiteLocale } from "@/lib/i18n/config";
import type { DownloadableEbookSlug } from "@/lib/ebook-entitlements";

export type PricingEbook = {
  slug: DownloadableEbookSlug;
  titles: Record<SiteLocale, string>;
  pageCount: number;
  pageHeight: number;
  monetizationRelated?: boolean;
};

export const pricingEbooks: readonly PricingEbook[] = [
  { slug: "monetization-7", titles: { ko: "쇼츠 수익화 7가지 방법", en: "7 Ways to Monetize Short Videos", ja: "ショート動画で収益を生む7つの方法" }, pageCount: 36, pageHeight: 2829, monetizationRelated: true },
  { slug: "multi-platform", titles: { ko: "유튜브·릴스·틱톡 동시 공략법", en: "YouTube Shorts, Reels & TikTok: A Practical Playbook", ja: "YouTube・リール・TikTokを同時に育てる実践ガイド" }, pageCount: 36, pageHeight: 2829 },
  { slug: "copyright-survival", titles: { ko: "쇼츠 저작권 생존 가이드", en: "The Short-Video Copyright Guide", ja: "ショート動画の著作権ガイド" }, pageCount: 36, pageHeight: 2829 },
  { slug: "monetization-playbook", titles: { ko: "숏폼 수익화 실전 가이드", en: "The Practical Short-Video Monetization Guide", ja: "ショート動画収益化の実践ガイド" }, pageCount: 20, pageHeight: 2589, monetizationRelated: true },
  { slug: "viral-formula", titles: { ko: "조회수 터지는 쇼츠의 공식", en: "Build Shorts People Want to Watch", ja: "見たくなるショート動画の作り方" }, pageCount: 36, pageHeight: 2829 },
  { slug: "low-views-diagnosis", titles: { ko: "조회수가 안 나오는 쇼츠 진단서", en: "Why Your Shorts Aren’t Getting Views", ja: "再生数が伸びないショート動画の診断書" }, pageCount: 36, pageHeight: 2829 },
  { slug: "title-300", titles: { ko: "클릭을 부르는 쇼츠 제목 300선", en: "300 Short-Video Title Templates", ja: "ショート動画のタイトル例300選" }, pageCount: 36, pageHeight: 2829 },
];

export function ebookPreviewSrc(slug: DownloadableEbookSlug, page: number, locale: SiteLocale) {
  const folder = locale === "ko" ? "" : `${locale}/`;
  return `/ebook-previews/${folder}${slug}/page-${String(page).padStart(2, "0")}${page <= 3 ? "-hq" : ""}.jpg${locale === "ko" ? "" : "?v=20261101"}`;
}

export function ebookRelativePdfPath(slug: DownloadableEbookSlug, locale: SiteLocale) {
  return locale === "ko" ? `${slug}.pdf` : `${locale}/${slug}.pdf`;
}

export function ebookDownloadName(slug: DownloadableEbookSlug, locale: SiteLocale) {
  const book = pricingEbooks.find((book) => book.slug === slug)!;
  return `Easy_Cut_${book.titles[locale]}.pdf`;
}

export function ebookPreviewHeight(book: PricingEbook, locale: SiteLocale) {
  return locale === "ko" ? book.pageHeight : 2829;
}
