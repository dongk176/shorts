import type { Metadata } from "next";
import Link from "next/link";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StructuredData } from "@/components/structured-data";
import { authProfile } from "@/lib/session";
import { createPageMetadata, SITE_URL } from "@/lib/seo";
import { getAuthenticatedUser } from "@/lib/supabase/server";

const PAGE_PATH = "/compare/ai-shorts-tools";
const REVIEWED_DATE = "2026-07-19";

export const metadata: Metadata = createPageMetadata({
  title: "AI 쇼츠 제작 툴 비교: 이지컷·알파컷·피카클립",
  description: "이지컷, 알파컷, 피카클립의 요금 기준, 월 제공량, AI 하이라이트, 자막, 템플릿과 편집 기능을 공식 공개정보 기준으로 비교합니다.",
  path: PAGE_PATH,
  type: "article",
});

const comparisonRows = [
  {
    label: "대표 입력 방식",
    easyCut: "공개 YouTube URL",
    alphaCut: "YouTube 링크·파일 업로드",
    fikaClip: "기존 영상 기반",
  },
  {
    label: "이용량 기준",
    easyCut: "원본 영상 처리시간",
    alphaCut: "원본 영상 처리시간",
    fikaClip: "숏폼 제작 횟수",
  },
  {
    label: "공개 플랜 제공량",
    easyCut: "월 100·200·600분",
    alphaCut: "월 50·150·450분",
    fikaClip: "월 5·15·50회",
  },
  {
    label: "하이라이트 자동 추출",
    easyCut: "제공",
    alphaCut: "제공",
    fikaClip: "제공",
  },
  {
    label: "제목·자막 편집",
    easyCut: "제목·자막·표시명 수정",
    alphaCut: "제목·길이·비율 조절 안내",
    fikaClip: "공개 기능 안내 확인 필요",
  },
  {
    label: "화면 비율",
    easyCut: "5종: 16:9~9:16",
    alphaCut: "비율 조절 안내",
    fikaClip: "공개 요금표에 미표기",
  },
  {
    label: "템플릿",
    easyCut: "4종",
    alphaCut: "커스텀 템플릿",
    fikaClip: "비디오 템플릿",
  },
  {
    label: "프로젝트 보관",
    easyCut: "플랜별 7·15·30일",
    alphaCut: "멤버십 편집 30일 안내",
    fikaClip: "공개 요금표에 미표기",
  },
  {
    label: "동시 작업",
    easyCut: "플랜별 1·2·3개",
    alphaCut: "공개 가이드에 미표기",
    fikaClip: "공개 요금표에 미표기",
  },
] as const;

const selectionGuides = [
  {
    title: "처리시간으로 계획하고 싶다면",
    description: "영상 분량을 기준으로 월 작업량을 계산하려면 이지컷과 알파컷처럼 원본 처리시간을 기준으로 제공량을 표시하는 서비스가 비교하기 쉽습니다.",
  },
  {
    title: "제작 횟수로 관리하고 싶다면",
    description: "매달 필요한 결과 수가 명확하다면 숏폼 제작 횟수를 기준으로 플랜을 안내하는 피카클립의 방식도 살펴볼 수 있습니다.",
  },
  {
    title: "여러 작업을 동시에 돌린다면",
    description: "동시 작업 수가 중요한 운영팀이라면 공개된 동시 작업 한도와 프로젝트 보관기간을 함께 확인해야 합니다.",
  },
] as const;

export default async function AiShortsToolsComparisonPage() {
  const user = await getAuthenticatedUser();
  const articleData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "AI 쇼츠 제작 툴 비교: 이지컷·알파컷·피카클립",
    description: "이지컷, 알파컷, 피카클립의 공개 기능과 요금 기준을 비교한 가이드",
    image: `${SITE_URL}/easy-cut-og-1200x630-v3.jpg`,
    datePublished: REVIEWED_DATE,
    dateModified: REVIEWED_DATE,
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
      { "@type": "ListItem", position: 2, name: "AI 쇼츠 툴 비교", item: `${SITE_URL}${PAGE_PATH}` },
    ],
  };
  return (
    <div className="app-shell site-chrome min-h-screen text-neutral-100">
      <StructuredData data={articleData} />
      <StructuredData data={breadcrumbData} />
      <SiteHeader><AuthControls user={user ? authProfile(user) : null} next={PAGE_PATH} /></SiteHeader>
      <main className="mx-auto w-full max-w-6xl px-5 pb-24 pt-10 sm:px-8 sm:pt-14">
        <header className="mx-auto max-w-4xl py-12 text-center sm:py-16">
          <p className="text-xs font-black uppercase tracking-[.2em] text-[#ff9b8d]">2026 AI Shorts Tools</p>
          <h1 className="mt-5 text-[28px] font-black leading-tight tracking-[-.05em] text-white sm:text-[42px]">이지컷·알파컷·피카클립<br /><span className="bg-gradient-to-r from-[#ff8c7c] to-violet-400 bg-clip-text text-transparent">AI 쇼츠 제작 툴 비교</span></h1>
          <p className="mx-auto mt-6 max-w-3xl text-sm leading-7 text-neutral-400 sm:text-base">롱폼 영상을 짧은 쇼츠로 바꾸는 서비스라도 이용량 계산, 생성 기준과 편집 범위는 다릅니다. 이 페이지는 각 서비스의 공식 공개정보를 같은 항목으로 정리합니다.</p>
          <p className="mt-4 text-xs text-neutral-500">공개정보 최종 확인일: 2026년 7월 19일</p>
        </header>

        <section aria-labelledby="quick-answer-title">
          <h2 id="quick-answer-title" className="text-2xl font-black tracking-[-.035em] text-white">먼저 보는 선택 기준</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <article className="rounded-2xl border border-[#ff8c7c]/30 bg-[#ff8c7c]/[.06] p-6">
              <h3 className="text-lg font-black text-[#ffb4a8]">이지컷(Easy Cut)</h3>
              <p className="mt-3 text-sm leading-7 text-neutral-300">YouTube URL 중심의 간단한 흐름, 5가지 비율, 8개 제목 언어와 플랜별 동시 작업 수를 확인하고 선택하려는 경우 비교해볼 수 있습니다.</p>
            </article>
            <article id="alphacut" className="scroll-mt-28 rounded-2xl border border-white/10 bg-black/15 p-6">
              <h3 className="text-lg font-black text-white">알파컷(AlphaCut)</h3>
              <p className="mt-3 text-sm leading-7 text-neutral-400">YouTube 링크와 파일 업로드, 무음 구간 제거·화자 트래킹 등 공식 안내 기능이 필요한 경우 살펴볼 수 있습니다.</p>
            </article>
            <article id="fikaclip" className="scroll-mt-28 rounded-2xl border border-white/10 bg-black/15 p-6">
              <h3 className="text-lg font-black text-white">피카클립(FikaClip)</h3>
              <p className="mt-3 text-sm leading-7 text-neutral-400">원본 분량보다 월 숏폼 제작 횟수 중심으로 플랜을 비교하고, 영상 업로드 정보까지 함께 확인하려는 경우 살펴볼 수 있습니다.</p>
            </article>
          </div>
        </section>

        <section aria-labelledby="comparison-table-title" className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[.18em] text-violet-300">Feature matrix</p>
              <h2 id="comparison-table-title" className="mt-2 text-2xl font-black tracking-[-.035em] text-white">기능·제공량 비교표</h2>
            </div>
            <p className="text-xs text-neutral-500">가격과 기능은 변경될 수 있으므로 결제 전 공식 페이지를 확인하세요.</p>
          </div>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full min-w-[850px] border-collapse text-left text-sm">
              <thead className="bg-white/[.045] text-neutral-300">
                <tr>
                  <th className="px-5 py-4 font-extrabold">비교 항목</th>
                  <th className="px-5 py-4 font-extrabold text-[#ffb4a8]">이지컷</th>
                  <th className="px-5 py-4 font-extrabold">알파컷</th>
                  <th className="px-5 py-4 font-extrabold">피카클립</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.label} className="border-t border-white/[.07] align-top">
                    <th className="px-5 py-4 font-bold text-white">{row.label}</th>
                    <td className="bg-[#ff8c7c]/[.035] px-5 py-4 text-neutral-200">{row.easyCut}</td>
                    <td className="px-5 py-4 text-neutral-400">{row.alphaCut}</td>
                    <td className="px-5 py-4 text-neutral-400">{row.fikaClip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs leading-6 text-neutral-500">“공개 요금표에 미표기”는 미지원이라는 뜻이 아니라, 이 비교 페이지 작성 시점에 해당 공식 공개 페이지에서 확인하지 못했다는 뜻입니다.</p>
        </section>

        <section aria-labelledby="alternative-title" className="mt-10">
          <h2 id="alternative-title" className="text-2xl font-black tracking-[-.035em] text-white">알파컷 대안·피카클립 대안을 찾을 때 볼 것</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {selectionGuides.map((guide) => (
              <article key={guide.title} className="rounded-2xl border border-white/10 bg-black/15 p-6">
                <h3 className="font-extrabold text-white">{guide.title}</h3>
                <p className="mt-3 text-sm leading-7 text-neutral-400">{guide.description}</p>
              </article>
            ))}
          </div>
          <div className="mt-7 rounded-2xl border border-violet-400/20 bg-violet-400/[.06] p-6">
            <h3 className="font-extrabold text-violet-200">비교표보다 중요한 실제 테스트</h3>
            <p className="mt-3 text-sm leading-7 text-neutral-300">같은 한국어 인터뷰나 강의 영상을 각 서비스에 넣고 하이라이트 구간, 자막 수정량, 제작 시간과 결과 개수를 직접 비교하는 것이 가장 정확합니다. 영상 유형과 편집 기준에 따라 결과는 달라질 수 있습니다.</p>
          </div>
        </section>

        <section aria-labelledby="sources-title" className="mt-10">
          <h2 id="sources-title" className="text-xl font-black text-white">비교 출처</h2>
          <ul className="mt-5 grid gap-3 text-sm leading-6 text-neutral-400">
            <li>이지컷: <Link href="/pricing" className="font-bold text-[#ff9b8d] underline underline-offset-4">공식 요금제</Link> 및 현재 서비스 공개 기능</li>
            <li>알파컷: <a href="https://alphacut.video/" target="_blank" rel="noreferrer" className="font-bold text-[#ff9b8d] underline underline-offset-4">공식 홈페이지</a> · <a href="https://alphacut.video/blog/guide" target="_blank" rel="noreferrer" className="font-bold text-[#ff9b8d] underline underline-offset-4">공식 서비스 가이드</a></li>
            <li>피카클립: <a href="https://www.fikad.boo/" target="_blank" rel="noreferrer" className="font-bold text-[#ff9b8d] underline underline-offset-4">공식 홈페이지</a> · <a href="https://www.fikad.boo/pricing" target="_blank" rel="noreferrer" className="font-bold text-[#ff9b8d] underline underline-offset-4">공식 요금제</a></li>
          </ul>
          <p className="mt-6 text-xs leading-6 text-neutral-500">알파컷(AlphaCut)과 피카클립(FikaClip)은 각 소유자의 상표입니다. 이지컷은 두 서비스와 제휴하거나 공식적으로 연관되어 있지 않습니다. 본 비교는 공개정보를 이해하기 쉽게 정리한 것으로, 특정 서비스의 우열이나 동일한 결과를 보장하지 않습니다.</p>
        </section>

        <section aria-labelledby="comparison-cta" className="mt-10 text-center">
          <p className="text-xs font-extrabold uppercase tracking-[.18em] text-[#ff9b8d]">Try Easy Cut</p>
          <h2 id="comparison-cta" className="mt-3 text-2xl font-black tracking-[-.035em] text-white sm:text-3xl">내 영상에 맞는지 직접 확인해보세요</h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-neutral-400">권리를 보유한 YouTube 영상 링크를 입력하면 예상 쇼츠 개수와 템플릿을 확인한 뒤 제작을 시작할 수 있습니다.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/#workspace" className="inline-flex min-h-12 items-center rounded-xl bg-white px-6 text-sm font-black text-black hover:bg-neutral-200">이지컷으로 쇼츠 만들기</Link>
            <Link href="/pricing" className="inline-flex min-h-12 items-center rounded-xl border border-white/15 px-6 text-sm font-black text-white hover:border-white/30">요금제 보기</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
