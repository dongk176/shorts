import { createLocalizedPageMetadata } from "@/lib/i18n/metadata";
import Image from "next/image";
import { getRequestLocale } from "@/lib/i18n/server";
import { localizedValue } from "@/lib/i18n/config";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StructuredData } from "@/components/structured-data";
import { authProfile } from "@/lib/session";
import { SITE_URL } from "@/lib/seo";
import { getAuthenticatedUser } from "@/lib/supabase/server";

const PAGE_PATH = "/guidebook";
const GUIDEBOOK_PAGES = Array.from({ length: 8 }, (_, index) => ({
  number: index + 1,
  src: `/guidebook/pages/page-${index + 1}.jpg`,
}));

export async function generateMetadata() {
  return createLocalizedPageMetadata({
    title: "어떤 영상을 쇼츠로 만들어야 할까? | 이지컷 가이드북",
    description:
      "한 채널을 한 카테고리, 한 주제, 한 크리에이터로 좁히는 쇼츠 채널 운영 가이드를 온라인에서 읽어보세요.",
    path: PAGE_PATH,
    type: "article",
  });
}

export default async function GuidebookPage() {
  const [user, locale] = await Promise.all([getAuthenticatedUser(), getRequestLocale()]);
  const guideTitle = localizedValue(locale, { ko: "어떤 영상을 쇼츠로 만들어야 할까?", en: "Which videos make great Shorts?", ja: "ショート動画に向いているのは、どんな動画？" });
  const documentData = {
    "@context": "https://schema.org",
    "@type": "DigitalDocument",
    name: "어떤 영상을 쇼츠로 만들어야 할까?",
    description:
      "한 채널의 주제와 크리에이터를 좁혀 오래 운영할 수 있는 쇼츠 채널을 만드는 실전 가이드",
    inLanguage: "ko-KR",
    numberOfPages: 8,
    url: `${SITE_URL}${PAGE_PATH}`,
    publisher: { "@id": `${SITE_URL}/#organization` },
  };

  return (
    <div className="app-shell site-chrome desktop-sidebar-layout min-h-screen text-neutral-100">
      <StructuredData data={documentData} />
      <SiteHeader desktopSidebar>
        <AuthControls
          user={user ? authProfile(user) : null}
          next={PAGE_PATH}
        />
      </SiteHeader>

      <main className="mx-auto w-full pb-24 pt-10 sm:px-8 sm:pt-14">
        <header className="mx-auto max-w-[640px] px-5 pb-10 text-center sm:px-0 sm:pb-14">
          <p className="text-xs font-black uppercase tracking-[.2em] text-[#42e8e8]">
            {localizedValue(locale, { ko: "Easy Cut 실전 가이드 · 8페이지", en: "Easy Cut channel guide · 8 pages", ja: "Easy Cut チャンネル運営ガイド · 全8ページ" })}
          </p>
          <h1 className="mt-4 text-balance text-[30px] font-black leading-[1.14] tracking-[-.05em] text-white sm:text-[42px]">
            {guideTitle}
          </h1>
          <p className="mt-4 text-sm leading-7 text-neutral-400 sm:text-base">
            {localizedValue(locale, {
              ko: "한 채널을 한 카테고리, 한 주제, 한 크리에이터로 좁혀 오래 운영할 수 있는 쇼츠 채널의 방향을 정해보세요.",
              en: "Build a focused Shorts channel around one category, topic, or creator.",
              ja: "カテゴリーやテーマ、クリエイターをひとつに絞り、続けられるチャンネルの方向性を見つけましょう。",
            })}
          </p>
          {locale !== "ko" && (
            <p className="mt-5 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-neutral-300">
              {localizedValue(locale, { ko: "한국어 가이드", en: "This guide is currently available in Korean only.", ja: "このガイドの本文は韓国語のみです。" })}
            </p>
          )}
        </header>

        <section
          aria-labelledby="guidebook-viewer-title"
          className="mx-auto w-full sm:max-w-[640px]"
          style={{
            border: 0,
            borderRadius: 0,
            padding: 0,
            background: "transparent",
            boxShadow: "none",
            backdropFilter: "none",
          }}
        >
          <h2 id="guidebook-viewer-title" className="sr-only">
            {localizedValue(locale, { ko: "쇼츠 채널 운영 가이드 8페이지", en: "Shorts channel guide, 8 pages, Korean edition", ja: "ショート動画運営ガイド・全8ページ（韓国語版）" })}
          </h2>
          <ol data-i18n-skip className="m-0 grid list-none gap-6 p-0 sm:gap-10">
            {GUIDEBOOK_PAGES.map((page) => (
              <li
                key={page.number}
                aria-label={localizedValue(locale, { ko: `${page.number}페이지`, en: `Page ${page.number} (Korean)`, ja: `${page.number}ページ（韓国語）` })}
              >
                <Image
                  src={page.src}
                  alt={localizedValue(locale, { ko: `어떤 영상을 쇼츠로 만들어야 할까? 가이드북 ${page.number}페이지`, en: `${guideTitle} — page ${page.number}, Korean edition`, ja: `${guideTitle} ${page.number}ページ（韓国語版）` })}
                  width={1319}
                  height={1864}
                  priority={page.number === 1}
                  unoptimized
                  sizes="(max-width: 640px) 100vw, 640px"
                  className="block h-auto w-full"
                />
              </li>
            ))}
          </ol>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
