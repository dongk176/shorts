import type { Metadata } from "next";
import Link from "next/link";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StructuredData } from "@/components/structured-data";
import { authProfile } from "@/lib/session";
import { createPageMetadata, SITE_URL } from "@/lib/seo";
import { getAuthenticatedUser } from "@/lib/supabase/server";

const PAGE_PATH = "/faq";

const faqs = [
  ["쇼츠 AI는 어떤 일을 하나요?", "긴 영상의 음성과 맥락을 분석해 핵심 구간을 찾고, 짧은 영상과 후킹 제목·자막 초안을 만드는 과정을 자동화합니다."],
  ["영상 하나에서 쇼츠가 몇 개 만들어지나요?", "영상 길이에 따라 기본 3개에서 최대 15개의 후보를 계획합니다. 실제 결과는 영상의 내용과 사용 가능한 하이라이트에 따라 달라질 수 있습니다."],
  ["어떤 YouTube 영상을 사용할 수 있나요?", "직접 업로드했거나 적법한 이용 권한을 가진 공개 영상을 사용해야 합니다. 비공개·유료·연령 제한·DRM 보호 등 이용이 제한된 영상은 처리하지 않습니다."],
  ["제목과 자막을 수정할 수 있나요?", "네. 생성 결과에서 후킹 제목, 채널 표시명, 자막과 템플릿을 수정한 뒤 다시 렌더링할 수 있습니다."],
  ["영상 길이 제한이 있나요?", "원본 영상은 최대 60분까지 분석할 수 있으며, 사용량은 처리하는 원본 영상 길이를 기준으로 계산됩니다."],
  ["알파컷이나 피카클립과 무엇이 다른가요?", "각 서비스는 사용량 계산, 생성 기준과 제공 기능이 다릅니다. 이지컷·알파컷·피카클립 비교 페이지에서 공식 공개정보 기준으로 확인할 수 있습니다."],
] as const;

export const metadata: Metadata = createPageMetadata({
  title: "AI 쇼츠 제작 자주 묻는 질문 | 이지컷",
  description: "쇼츠 AI 기능, 생성 개수, 사용 가능한 YouTube 영상, 제목·자막 편집, 영상 길이 제한과 AI 쇼츠 툴의 차이를 확인하세요.",
  path: PAGE_PATH,
});

export default async function FaqPage() {
  const user = await getAuthenticatedUser();
  const faqData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(([question, answer]) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
  const breadcrumbData = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "홈", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "자주 묻는 질문", item: `${SITE_URL}${PAGE_PATH}` },
    ],
  };

  return (
    <div className="app-shell site-chrome min-h-screen text-neutral-100">
      <StructuredData data={faqData} />
      <StructuredData data={breadcrumbData} />
      <SiteHeader><AuthControls user={user ? authProfile(user) : null} next={PAGE_PATH} /></SiteHeader>
      <main className="mx-auto w-full max-w-5xl px-5 pb-24 pt-10 sm:px-8 sm:pt-14">
        <nav aria-label="현재 위치" className="text-xs font-semibold text-neutral-500">
          <Link href="/" className="hover:text-white">홈</Link><span className="mx-2">/</span><span>자주 묻는 질문</span>
        </nav>

        <header className="mx-auto max-w-3xl py-12 text-center sm:py-16">
          <p className="text-xs font-black uppercase tracking-[.2em] text-[#ff9b8d]">FAQ</p>
          <h1 className="mt-5 text-3xl font-black leading-tight tracking-[-.05em] text-white sm:text-5xl">AI 쇼츠 제작<br /><span className="bg-gradient-to-r from-[#ff8c7c] to-violet-400 bg-clip-text text-transparent">자주 묻는 질문</span></h1>
          <p className="mx-auto mt-6 max-w-2xl text-sm leading-7 text-neutral-400 sm:text-base">이지컷의 쇼츠 AI 기능, 사용할 수 있는 영상과 생성 결과 편집에 관한 주요 답변을 확인하세요.</p>
        </header>

        <section aria-labelledby="faq-list-title">
          <h2 id="faq-list-title" className="sr-only">이지컷 AI 쇼츠 제작 질문과 답변</h2>
          <div className="mx-auto grid max-w-4xl gap-3">
            {faqs.map(([question, answer]) => (
              <details key={question} className="group rounded-2xl border border-white/10 bg-black/15 px-5 py-5 open:bg-white/[.035] sm:px-6">
                <summary className="cursor-pointer list-none pr-8 text-base font-extrabold text-white marker:hidden sm:text-lg">{question}</summary>
                <p className="mt-4 text-sm leading-7 text-neutral-400">{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section aria-labelledby="faq-next-title" className="mt-10 text-center">
          <h2 id="faq-next-title" className="text-2xl font-black tracking-[-.035em] text-white">더 확인하고 싶은 내용이 있나요?</h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-neutral-400">서비스별 기능과 제공량은 비교 페이지에서 확인하고, 계정·결제 관련 문의는 고객센터로 보내주세요.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/compare/ai-shorts-tools" className="inline-flex min-h-12 items-center rounded-xl bg-white px-6 text-sm font-black text-black hover:bg-neutral-200">AI 쇼츠 툴 비교</Link>
            <Link href="/support" className="inline-flex min-h-12 items-center rounded-xl border border-white/15 px-6 text-sm font-black text-white hover:border-white/30">고객센터</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
