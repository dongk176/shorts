import type { Metadata } from "next";
import { StructuredData } from "@/components/structured-data";
import { createPageMetadata, DEFAULT_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/seo";
import { getRequestLocale } from "@/lib/i18n/server";
import { localizedValue } from "@/lib/i18n/config";
import { loadMvpState } from "@/lib/mvp-state";
import { ShortsApp } from "./shorts-app";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return createPageMetadata({
    title: localizedValue(locale, {
      ko: "이지컷 | AI 쇼츠 자동 제작",
      en: "Easy Cut | AI Shorts Maker",
      ja: "Easy Cut | AIショート動画自動作成",
    }),
    description: localizedValue(locale, { ko: DEFAULT_DESCRIPTION, en: "Paste a YouTube link and let AI find highlights, create 30–60 second Shorts, hook titles, and captions automatically.", ja: "YouTubeリンクを貼り付けるだけで、AIがハイライトを見つけ、30〜60秒のショート動画、フックタイトル、字幕を自動作成します。" }),
    path: "/",
  });
}

export default async function Home() {
  const [locale, initialState] = await Promise.all([
    getRequestLocale(),
    loadMvpState().catch((error) => {
      console.error("home_initial_state_failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return null;
    }),
  ]);
  const applicationData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "@id": `${SITE_URL}/#application`,
    name: SITE_NAME,
    alternateName: ["EasyCut", "Easy Cut", "쇼츠 AI"],
    url: SITE_URL,
    description: localizedValue(locale, { ko: DEFAULT_DESCRIPTION, en: "AI-powered YouTube Shorts creation with automatic highlights, titles, and captions.", ja: "ハイライト、タイトル、字幕を自動生成するAI YouTubeショート動画制作サービスです。" }),
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    browserRequirements: localizedValue(locale, { ko: "최신 웹 브라우저와 JavaScript가 필요합니다.", en: "A modern web browser with JavaScript is required.", ja: "最新のウェブブラウザとJavaScriptが必要です。" }),
    inLanguage: locale,
    featureList: [
      localizedValue(locale, { ko: "YouTube 링크 기반 AI 하이라이트 추출", en: "AI highlight extraction from YouTube links", ja: "YouTubeリンクからAIでハイライトを抽出" }),
      localizedValue(locale, { ko: "30~60초 쇼츠 자동 제작", en: "Automatic 30–60 second Shorts creation", ja: "30〜60秒のショート動画を自動作成" }),
      localizedValue(locale, { ko: "자동 자막과 후킹 제목", en: "Automatic captions and hook titles", ja: "字幕とフックタイトルを自動生成" }),
      localizedValue(locale, { ko: "5가지 영상 비율", en: "Five video aspect ratios", ja: "5種類の動画比率" }),
      localizedValue(locale, { ko: "4가지 쇼츠 템플릿", en: "Four Shorts templates", ja: "4種類のショート動画テンプレート" }),
      localizedValue(locale, { ko: "제목과 자막 편집", en: "Title and caption editing", ja: "タイトルと字幕の編集" }),
    ],
    offers: [
      { "@type": "Offer", name: "PLUS", price: "9900", priceCurrency: "KRW", url: `${SITE_URL}/pricing` },
      { "@type": "Offer", name: "STANDARD", price: "19900", priceCurrency: "KRW", url: `${SITE_URL}/pricing` },
      { "@type": "Offer", name: "PRO", price: "49900", priceCurrency: "KRW", url: `${SITE_URL}/pricing` },
    ],
    provider: { "@id": `${SITE_URL}/#organization` },
  };
  return (
    <>
      <StructuredData data={applicationData} />
      <ShortsApp initialState={initialState} />
    </>
  );
}
