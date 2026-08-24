import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { absoluteUrl, createNoIndexMetadata, SITE_NAME } from "@/lib/seo";
import { PartnerApplicationForm } from "./partner-application-form";

const pageTitle = "EASYCUT PARTNER 1기 신청";
const pageDescription = "이지컷을 함께 소개하고 수익을 만들 파트너 1기를 모집합니다.";
const previewImage = "/easycut-partner-1-og.png";

export const metadata: Metadata = {
  ...createNoIndexMetadata(pageTitle, pageDescription),
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: absoluteUrl("/partner/apply"),
    siteName: SITE_NAME,
    title: pageTitle,
    description: pageDescription,
    images: [{
      url: previewImage,
      width: 1200,
      height: 630,
      alt: "EASY CUT 파트너 1기 모집 · 10명 한정",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: pageTitle,
    description: pageDescription,
    images: [previewImage],
  },
};

const highlights = [
  { label: "모집 인원", value: "10명", note: "첫 기수 소규모 운영" },
  { label: "활동 방식", value: "콘텐츠 추천", note: "내 채널에 맞는 방식으로" },
  { label: "파트너 혜택", value: "수익 + 이용 혜택", note: "추천 결제 발생 시 제공" },
];

export default function PartnerApplyPage() {
  return (
    <main className="partner-application-page relative min-h-screen overflow-hidden bg-[#0d0f10] text-neutral-100">
      <style>{"body:has(.partner-application-page) .language-selector-floating { display: none; }"}</style>
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-40 -top-48 h-[520px] w-[520px] rounded-full bg-[#ff715e]/[.10] blur-[130px]" />
        <div className="absolute -right-44 top-[32rem] h-[520px] w-[520px] rounded-full bg-[#a078ff]/[.09] blur-[140px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.018)_1px,transparent_1px)] bg-[size:52px_52px] [mask-image:linear-gradient(to_bottom,black,transparent_72%)]" />
      </div>

      <header className="relative z-10 border-b border-white/[.07] bg-[#0d0f10]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] w-full max-w-[1240px] items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label="이지컷 홈으로 이동">
            <Image src="/east-cut-logo.png" alt="" width={34} height={34} priority />
            <span className="text-[17px] font-black tracking-[-.045em]">EASY CUT</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs font-semibold text-neutral-500 sm:block">이미 파트너이신가요?</span>
            <Link
              href="/partner/login"
              className="rounded-full border border-white/[.12] px-4 py-2 text-xs font-bold text-neutral-300 transition hover:border-white/25 hover:bg-white/[.05] hover:text-white"
            >
              파트너 로그인
            </Link>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto grid w-full max-w-[1240px] gap-12 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[minmax(0,.88fr)_minmax(560px,1.12fr)] lg:gap-16 lg:py-20">
        <section className="lg:sticky lg:top-12 lg:self-start">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#ff9585]/20 bg-[#ff715e]/[.07] px-3.5 py-2 text-[11px] font-black tracking-[.16em] text-[#ff9f91]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#ff715e] shadow-[0_0_10px_#ff715e]" />
            EASYCUT PARTNER · 1기
          </div>
          <h1 className="mt-6 max-w-xl text-[2.35rem] font-black leading-[1.12] tracking-[-.06em] sm:text-[3.25rem] lg:text-[3.6rem]">
            이지컷과 함께
            <br />
            <span className="bg-gradient-to-r from-[#ff8c7c] via-[#ffb3a8] to-[#b89aff] bg-clip-text text-transparent">
              성장할 파트너
            </span>
            를 찾습니다.
          </h1>
          <p className="mt-6 max-w-lg text-[15px] font-medium leading-7 text-neutral-400 sm:text-base">
            평소 운영하는 SNS, 블로그, 유튜브, 커뮤니티에서 이지컷을 소개해 주세요.
            추천을 통해 결제가 발생하면 파트너 수익과 이지컷 이용 혜택을 제공합니다.
          </p>

          <div className="mt-9 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {highlights.map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-white/[.08] bg-white/[.035] p-4 backdrop-blur-sm"
              >
                <p className="text-[10px] font-black tracking-[.12em] text-neutral-600">{item.label}</p>
                <p className="mt-2 text-sm font-black tracking-[-.03em] text-neutral-100">{item.value}</p>
                <p className="mt-1 text-[11px] leading-4 text-neutral-600">{item.note}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-2xl border border-white/[.07] bg-black/20 p-5">
            <p className="text-xs font-black text-neutral-300">이런 분을 기다리고 있어요</p>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-neutral-500">
              <li className="flex gap-3">
                <CheckIcon />
                영상 제작·AI 도구에 관심이 있는 분
              </li>
              <li className="flex gap-3">
                <CheckIcon />
                운영 중인 채널이나 커뮤니티가 있는 분
              </li>
              <li className="flex gap-3">
                <CheckIcon />
                직접 써보고 솔직하게 소개할 수 있는 분
              </li>
            </ul>
          </div>
        </section>

        <section className="min-w-0">
          <div className="mb-5 flex items-end justify-between gap-4 px-1">
            <div>
              <p className="text-xs font-black uppercase tracking-[.16em] text-[#b89aff]">Application</p>
              <h2 className="mt-2 text-2xl font-black tracking-[-.045em] sm:text-[1.7rem]">파트너 신청하기</h2>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold text-neutral-400">9개 항목</p>
              <p className="mt-1 text-[11px] text-neutral-600">약 2분 소요</p>
            </div>
          </div>
          <PartnerApplicationForm />
        </section>
      </div>
    </main>
  );
}

function CheckIcon() {
  return (
    <span className="mt-1 grid h-4 w-4 flex-none place-items-center rounded-full bg-[#ff715e]/10 text-[#ff9585]" aria-hidden="true">
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none">
        <path d="m4 8.2 2.5 2.4L12 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
