import type { Metadata } from "next";
import Link from "next/link";
import { AuthControls } from "@/components/auth-controls";
import { AiShortsGuideContent } from "@/components/home-seo-content";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StructuredData } from "@/components/structured-data";
import { authProfile } from "@/lib/session";
import { createPageMetadata, SITE_URL } from "@/lib/seo";
import { getAuthenticatedUser } from "@/lib/supabase/server";

const PAGE_PATH = "/ai-shorts-maker";
const PUBLISHED_DATE = "2026-07-19";

export const metadata: Metadata = createPageMetadata({
  title: "AI 쇼츠 만들기: 유튜브 영상으로 쇼츠 자동 제작 | 이지컷",
  description: "유튜브 링크를 입력해 AI 하이라이트를 찾고, 30~60초 쇼츠와 제목·자막을 자동 제작하는 방법과 이지컷의 주요 기능을 확인하세요.",
  path: PAGE_PATH,
  type: "article",
});

export default async function AiShortsMakerPage() {
  const user = await getAuthenticatedUser();
  const articleData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "유튜브 영상으로 AI 쇼츠 만드는 방법",
    description: "유튜브 링크 입력부터 AI 하이라이트 분석, 쇼츠 편집과 다운로드까지 설명하는 이지컷 가이드",
    image: `${SITE_URL}/easy-cut-og-1200x630-v3.jpg`,
    datePublished: PUBLISHED_DATE,
    dateModified: PUBLISHED_DATE,
    inLanguage: "ko-KR",
    mainEntityOfPage: `${SITE_URL}${PAGE_PATH}`,
    author: { "@id": `${SITE_URL}/#organization` },
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
  const breadcrumbData = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "홈", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "AI 쇼츠 제작 가이드", item: `${SITE_URL}${PAGE_PATH}` },
    ],
  };
  return (
    <div className="app-shell site-chrome min-h-screen text-neutral-100">
      <StructuredData data={articleData} />
      <StructuredData data={breadcrumbData} />
      <SiteHeader><AuthControls user={user ? authProfile(user) : null} next={PAGE_PATH} /></SiteHeader>
      <main className="mx-auto w-full max-w-6xl px-5 pb-24 pt-10 sm:px-8 sm:pt-14">
        <header className="mx-auto max-w-4xl py-12 text-center sm:py-16">
          <p className="text-xs font-black uppercase tracking-[.2em] text-[#ff9b8d]">AI Shorts Maker Guide</p>
          <h1 className="mt-5 text-3xl font-black leading-tight tracking-[-.05em] text-white sm:text-5xl">유튜브 영상으로<br /><span className="bg-gradient-to-r from-[#ff8c7c] to-violet-400 bg-clip-text text-transparent">AI 쇼츠 만드는 방법</span></h1>
          <p className="mx-auto mt-6 max-w-3xl text-sm leading-7 text-neutral-400 sm:text-base">긴 영상에서 핵심 구간을 찾고 제목, 자막, 비율과 템플릿을 적용해 짧은 숏폼으로 완성하는 과정을 확인하세요.</p>
        </header>

        <div className="space-y-10">
          <AiShortsGuideContent />
        </div>

        <section aria-labelledby="guide-next-title" className="mt-10 text-center">
          <h2 id="guide-next-title" className="text-2xl font-black tracking-[-.035em] text-white">다음으로 확인할 내용</h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-neutral-400">서비스 이용에 관한 답변과 AI 쇼츠 제작 도구별 차이도 별도 페이지에서 확인할 수 있습니다.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/faq" className="inline-flex min-h-12 items-center rounded-xl bg-white px-6 text-sm font-black text-black hover:bg-neutral-200">자주 묻는 질문</Link>
            <Link href="/compare/ai-shorts-tools" className="inline-flex min-h-12 items-center rounded-xl border border-white/15 px-6 text-sm font-black text-white hover:border-white/30">AI 쇼츠 툴 비교</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
