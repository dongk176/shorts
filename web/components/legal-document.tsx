"use client";

import Link from "@/lib/i18n/navigation";
import { Children, type ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
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
  const trimmed = value.trim();
  const revisedMatch = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일 개정 · 구매약관 v(\d+)$/.exec(trimmed);
  if (revisedMatch) {
    const formatted = new Intl.DateTimeFormat(formatLocale(locale), { dateStyle: "long", timeZone: "UTC" })
      .format(new Date(Date.UTC(Number(revisedMatch[1]), Number(revisedMatch[2]) - 1, Number(revisedMatch[3]))));
    return locale === "en"
      ? `Revised ${formatted} · Purchase Terms v${revisedMatch[4]}`
      : `${formatted}改定 · 購入規約 v${revisedMatch[4]}`;
  }
  const match = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/.exec(trimmed);
  if (!match) return value;
  return new Intl.DateTimeFormat(formatLocale(locale), { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

export function LegalDocument({ eyebrow, title, description, effectiveDate, children, translations, sectionIds, introduction, supplement, showTranslationNotice = true, preventTextSelection = true }: {
  eyebrow: string;
  title: string;
  description: string;
  effectiveDate: string;
  children: ReactNode;
  translations?: Partial<Record<SiteLocale, LegalTranslation>>;
  sectionIds?: Partial<Record<number, string>>;
  introduction?: ReactNode;
  supplement?: ReactNode;
  showTranslationNotice?: boolean;
  preventTextSelection?: boolean;
}) {
  const { locale, t } = useI18n();
  const translated = locale === "ko" ? undefined : translations?.[locale];
  return (
    <div
      className={`${preventTextSelection ? "legal-document-page " : ""}site-chrome desktop-sidebar-layout min-h-screen bg-[#101415] text-neutral-100`}
      onCopy={preventTextSelection ? (event) => event.preventDefault() : undefined}
      onDragStart={preventTextSelection ? (event) => event.preventDefault() : undefined}
    >
      <SiteHeader desktopSidebar showUsageIndicator={false}>
        <Link href="/" className="header-cta">{t("legal.home")}</Link>
      </SiteHeader>
      <main className="mx-auto w-full min-w-0 max-w-4xl px-5 py-14 sm:px-8 sm:py-20">
        <div className="border-b border-white/10 pb-10">
          <p className="text-xs font-black uppercase tracking-[.22em] text-[#ff8c7c]">{translated?.eyebrow ?? eyebrow}</p>
          <h1 className="mt-4 text-[28px] font-black tracking-tight text-white sm:text-[42px]">{translated?.title ?? title}</h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-neutral-400 sm:text-base">{translated?.description ?? description}</p>
          <p className="mt-5 text-xs font-semibold text-neutral-500">{t("legal.effectiveDate", { date: localizedEffectiveDate(effectiveDate, locale) })}</p>
          {showTranslationNotice && locale !== "ko" && (
            <p className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/[.06] px-4 py-3 text-xs leading-6 text-amber-100">
              {t(translated ? "legal.translationNotice" : "legal.koreanOnlyNotice")}
            </p>
          )}
        </div>
        <article className="legal-document mt-10 space-y-10">
          {introduction}
          {translated
            ? translated.sections.map((section, index) => (
                <LegalSection key={section.title} id={sectionIds?.[index]} title={section.title}>
                  {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                </LegalSection>
              ))
            : Children.toArray(children)}
          {supplement}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}

export function LegalSection({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return <section id={id} className="scroll-mt-24"><h2 className="text-xl font-black tracking-tight text-white">{title}</h2><div className="mt-4 space-y-3 text-sm leading-7 text-neutral-300">{children}</div></section>;
}
