import type { Metadata } from "next";
import Image from "next/image";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StructuredData } from "@/components/structured-data";
import { authProfile } from "@/lib/session";
import { createPageMetadata, SITE_URL } from "@/lib/seo";
import { getAuthenticatedUser } from "@/lib/supabase/server";

const PAGE_PATH = "/guidebook";
const GUIDEBOOK_PAGES = Array.from({ length: 8 }, (_, index) => ({
  number: index + 1,
  src: `/guidebook/pages/page-${index + 1}.jpg`,
}));

export const metadata: Metadata = createPageMetadata({
  title: "어떤 영상을 쇼츠로 만들어야 할까? | 이지컷 가이드북",
  description:
    "한 채널을 한 카테고리, 한 주제, 한 크리에이터로 좁히는 쇼츠 채널 운영 가이드를 온라인에서 읽어보세요.",
  path: PAGE_PATH,
  type: "article",
});

export default async function GuidebookPage() {
  const user = await getAuthenticatedUser();
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
    <div className="app-shell site-chrome min-h-screen text-neutral-100">
      <StructuredData data={documentData} />
      <SiteHeader>
        <AuthControls
          user={user ? authProfile(user) : null}
          next={PAGE_PATH}
        />
      </SiteHeader>

      <main className="mx-auto w-full pb-24 pt-10 sm:px-8 sm:pt-14">
        <header className="mx-auto max-w-[640px] px-5 pb-10 text-center sm:px-0 sm:pb-14">
          <p className="text-xs font-black uppercase tracking-[.2em] text-[#42e8e8]">
            Easy Cut 실전 가이드 · 8페이지
          </p>
          <h1 className="mt-4 text-[30px] font-black leading-[1.14] tracking-[-.05em] text-white sm:text-[42px]">
            어떤 영상을 쇼츠로 만들어야 할까?
          </h1>
          <p className="mt-4 text-sm leading-7 text-neutral-400 sm:text-base">
            한 채널을 한 카테고리, 한 주제, 한 크리에이터로 좁혀
            오래 운영할 수 있는 쇼츠 채널의 방향을 정해보세요.
          </p>
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
            쇼츠 채널 운영 가이드 8페이지
          </h2>
          <ol className="m-0 grid list-none gap-6 p-0 sm:gap-10">
            {GUIDEBOOK_PAGES.map((page) => (
              <li
                key={page.number}
                aria-label={`${page.number}페이지`}
              >
                <Image
                  src={page.src}
                  alt={`어떤 영상을 쇼츠로 만들어야 할까? 가이드북 ${page.number}페이지`}
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
