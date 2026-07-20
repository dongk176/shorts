import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";

export function LegalDocument({ eyebrow, title, description, effectiveDate, children }: {
  eyebrow: string;
  title: string;
  description: string;
  effectiveDate: string;
  children: ReactNode;
}) {
  return (
    <div className="site-chrome min-h-screen bg-[#101415] text-neutral-100">
      <header className="site-header">
        <div className="mx-auto flex h-[72px] max-w-4xl items-center justify-between px-5 sm:px-8">
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
      <SiteFooter />
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return <section><h2 className="text-xl font-black tracking-tight text-white">{title}</h2><div className="mt-4 space-y-3 text-sm leading-7 text-neutral-300">{children}</div></section>;
}
