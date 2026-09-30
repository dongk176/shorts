import { createLocalizedPageMetadata } from "@/lib/i18n/metadata";
import type { Metadata } from "next";
import { StructuredData } from "@/components/structured-data";
import { EnterpriseServiceGate } from "@/components/enterprise-service-gate";
import { DEFAULT_DESCRIPTION, SITE_URL } from "@/lib/seo";
import { getRequestLocale } from "@/lib/i18n/server";
import { localizedValue } from "@/lib/i18n/config";
import { loadMvpState } from "@/lib/mvp-state";
import { applicationIdentity, publicMonthlyOffer } from "@/lib/seo-structured-data";
import { paddleConfigured, paddleEnabled } from "@/lib/paddle/config";
import { ShortsApp } from "./shorts-app";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return createLocalizedPageMetadata({
    title: localizedValue(locale, {
      ko: "이지컷 | AI 쇼츠 자동 제작·유튜브 영상 편집",
      en: "Easy Cut | AI YouTube Shorts Maker & Video Editor",
      ja: "Easy Cut | AIショート動画作成・YouTube動画編集",
    }),
    description: localizedValue(locale, { ko: DEFAULT_DESCRIPTION, en: "Paste a YouTube link and let AI find highlights, create 30–60 second Shorts, attention-grabbing titles, and captions automatically.", ja: "YouTubeリンクを貼り付けるだけで、AIがハイライトを見つけ、30〜60秒のショート動画、目を引くタイトル、字幕を自動作成します。" }),
    path: "/",
  });
}

export default async function Home() {
  const locale = await getRequestLocale();
  const initialState = await loadMvpState(undefined, undefined, locale).catch((error) => {
    console.error("home_initial_state_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  });
  const monthlyOffer = publicMonthlyOffer(locale, paddleConfigured() && paddleEnabled());
  const applicationData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "@id": `${SITE_URL}/#application`,
    ...applicationIdentity(locale),
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    browserRequirements: localizedValue(locale, { ko: "최신 웹 브라우저와 JavaScript가 필요합니다.", en: "A modern web browser with JavaScript is required.", ja: "最新のウェブブラウザとJavaScriptが必要です。" }),
    inLanguage: locale,
    featureList: [
      localizedValue(locale, { ko: "YouTube 링크 기반 AI 하이라이트 추출", en: "AI highlight extraction from YouTube links", ja: "YouTubeリンクからAIでハイライトを抽出" }),
      localizedValue(locale, { ko: "30~60초 쇼츠 자동 제작", en: "Automatic 30–60 second Shorts creation", ja: "30〜60秒のショート動画を自動作成" }),
      localizedValue(locale, { ko: "자동 자막과 후킹 제목", en: "Automatic captions and attention-grabbing titles", ja: "字幕と目を引くタイトルを自動生成" }),
      localizedValue(locale, { ko: "5가지 영상 비율", en: "Five video aspect ratios", ja: "5種類の動画比率" }),
      localizedValue(locale, { ko: "다양한 쇼츠 템플릿", en: "Customizable Shorts templates", ja: "カスタマイズできるショート動画テンプレート" }),
      localizedValue(locale, { ko: "제목과 자막 편집", en: "Title and caption editing", ja: "タイトルと字幕の編集" }),
    ],
    ...(monthlyOffer ? { offers: [monthlyOffer] } : {}),
    provider: { "@id": `${SITE_URL}/#organization` },
  };
  return (
    <>
      <StructuredData data={applicationData} />
      {initialState?.enterpriseAccess.accountType === "enterprise"
        && !initialState.enterpriseAccess.allowed
        ? <EnterpriseServiceGate access={initialState.enterpriseAccess} />
        : <ShortsApp initialState={initialState} />}
    </>
  );
}
