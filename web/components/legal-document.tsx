"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { useI18n } from "@/lib/i18n/provider";
import { formatLocale } from "@/lib/i18n/config";
import type { SiteLocale } from "@/lib/i18n/config";

export type LegalTranslation = {
  eyebrow: string;
  title: string;
  description: string;
  sections: Array<{ title: string; paragraphs: string[] }>;
};

function localizedEffectiveDate(value: string, locale: "ko" | "en" | "ja") {
  if (locale === "ko") return value;
  const match = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/.exec(value.trim());
  if (!match) return value;
  return new Intl.DateTimeFormat(formatLocale(locale), { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

export function LegalDocument({ eyebrow, title, description, effectiveDate, children, translations, sectionIds, showTranslationNotice = true, preventTextSelection = true }: {
  eyebrow: string;
  title: string;
  description: string;
  effectiveDate: string;
  children: ReactNode;
  translations?: Partial<Record<SiteLocale, LegalTranslation>>;
  sectionIds?: Partial<Record<number, string>>;
  showTranslationNotice?: boolean;
  preventTextSelection?: boolean;
}) {
  const { locale, t } = useI18n();
  const translated = locale === "ko" ? undefined : translations?.[locale];
  return (
    <div
      className={`${preventTextSelection ? "legal-document-page " : ""}site-chrome min-h-screen bg-[#101415] text-neutral-100`}
      onCopy={preventTextSelection ? (event) => event.preventDefault() : undefined}
      onDragStart={preventTextSelection ? (event) => event.preventDefault() : undefined}
    >
      <header className="site-header">
        <div className="mx-auto flex h-[72px] max-w-4xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="text-lg font-black tracking-tight text-white">Easy <em className="not-italic text-[#ff7b69]">Cut</em></Link>
          <div className="flex items-center gap-2">
            <Link href="/" className="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-neutral-300 transition hover:border-white/25 hover:text-white">{t("legal.home")}</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-14 sm:px-8 sm:py-20">
        <div className="border-b border-white/10 pb-10">
          <p className="text-xs font-black uppercase tracking-[.22em] text-[#ff8c7c]">{translated?.eyebrow ?? eyebrow}</p>
          <h1 className="mt-4 text-[28px] font-black tracking-tight text-white sm:text-[42px]">{translated?.title ?? title}</h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-neutral-400 sm:text-base">{translated?.description ?? description}</p>
          <p className="mt-5 text-xs font-semibold text-neutral-500">{t("legal.effectiveDate", { date: localizedEffectiveDate(effectiveDate, locale) })}</p>
          {showTranslationNotice && locale !== "ko" && (
            <p className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/[.06] px-4 py-3 text-xs leading-6 text-amber-100">
              {t("legal.translationNotice")}
            </p>
          )}
        </div>
        <article className="legal-document mt-10 space-y-10">
          {translated
            ? translated.sections.map((section, index) => (
                <LegalSection key={section.title} id={sectionIds?.[index]} title={section.title}>
                  {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                </LegalSection>
              ))
            : children}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}

export function LegalSection({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return <section id={id} className="scroll-mt-24"><h2 className="text-xl font-black tracking-tight text-white">{title}</h2><div className="mt-4 space-y-3 text-sm leading-7 text-neutral-300">{children}</div></section>;
}
