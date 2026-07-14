import Link from "next/link";
import type { ReactNode } from "react";

export function LegalDocument({ eyebrow, title, description, effectiveDate, children }: {
  eyebrow: string;
  title: string;
  description: string;
  effectiveDate: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#101415] text-neutral-100">
      <header className="border-b border-white/10 bg-[#101415]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-5 sm:px-8">
          <Link href="/" className="text-lg font-black tracking-tight text-white">Easy <em className="not-italic text-[#ff7b69]">Cut</em></Link>
          <Link href="/" className="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-neutral-300 transition hover:border-white/25 hover:text-white">홈으로</Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-14 sm:px-8 sm:py-20">
        <div className="border-b border-white/10 pb-10">
          <p className="text-xs font-black uppercase tracking-[.22em] text-[#ff8c7c]">{eyebrow}</p>
          <h1 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-5xl">{title}</h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-neutral-400 sm:text-base">{description}</p>
          <p className="mt-5 text-xs font-semibold text-neutral-500">시행일: {effectiveDate}</p>
        </div>
        <article className="legal-document mt-10 space-y-10">{children}</article>
      </main>
      <footer className="border-t border-white/10 bg-[#0b0f10]">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 px-5 py-8 text-xs text-neutral-500 sm:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><span>© 2026 Easy Cut · 아티룸 · 대표 김동민</span><div className="flex gap-5"><Link href="/terms" className="hover:text-white">이용약관</Link><Link href="/privacy" className="hover:text-white">개인정보처리방침</Link><Link href="/support" className="hover:text-white">고객센터</Link></div></div>
          <p>사업자등록번호 638-04-03590 · 통신판매업 신고번호 2025-서울마포-2971 · 서울특별시 마포구 성산로8길 40</p>
        </div>
      </footer>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return <section><h2 className="text-xl font-black tracking-tight text-white">{title}</h2><div className="mt-4 space-y-3 text-sm leading-7 text-neutral-300">{children}</div></section>;
}
