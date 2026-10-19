import { Suspense } from "react";
import type { SiteLocale } from "@/lib/i18n/config";
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
      <Suspense fallback={<HomeLoading locale={locale} />}>
        <HomeContent locale={locale} />
      </Suspense>
    </>
  );
}

async function HomeContent({ locale }: { locale: SiteLocale }) {
  const initialState = await loadMvpState(undefined, undefined, locale, { includeRecentJobs: false }).catch((error) => {
    console.error("home_initial_state_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  });
  return (initialState?.enterpriseAccess.accountType === "enterprise"
        && !initialState.enterpriseAccess.allowed
        ? <EnterpriseServiceGate access={initialState.enterpriseAccess} />
        : <ShortsApp key={`${locale}:${initialState?.user?.id ?? "guest"}`} initialState={initialState} initialLocale={locale} initialStateLoadedAt={Date.now()} />);
}

function HomeLoading({ locale }: { locale: SiteLocale }) {
  return <main className="mx-auto w-full max-w-6xl px-5 py-20" aria-busy="true">
    <h1 className="text-3xl font-bold text-white">{localizedValue(locale, {
      ko: "AI 쇼츠 만들기", en: "Create AI Shorts", ja: "AIショート動画を作成",
    })}</h1>
    <p role="status" className="mt-4 text-base text-neutral-400">{localizedValue(locale, {
      ko: "계정 정보를 불러오는 중…", en: "Loading your account…", ja: "アカウント情報を読み込み中…",
    })}</p>
    <div aria-hidden="true" className="mt-8 h-36 rounded-2xl border border-white/10 bg-white/5" />
  </main>;
}
