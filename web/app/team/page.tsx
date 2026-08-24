import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StructuredData } from "@/components/structured-data";
import type { SiteLocale } from "@/lib/i18n/config";
import { getRequestLocale } from "@/lib/i18n/server";
import { authProfile } from "@/lib/session";
import { TEAM_PAGE_VISIBLE } from "@/lib/site-visibility";
import { createPageMetadata, SITE_URL } from "@/lib/seo";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import codexPhoto from "@/public/team/codex.webp";
import kimDongMinPhoto from "@/public/team/kim-dong-min.webp";

const PAGE_PATH = "/team";

type TeamCopy = {
  metadataTitle: string;
  metadataDescription: string;
  name: string;
  role: string;
  summary: string;
  imageAlt: string;
  codexRole: string;
  codexItems: readonly string[];
  codexNote: string;
  codexImageAlt: string;
  profileGroups: ReadonlyArray<{
    label: string;
    items: readonly string[];
  }>;
};

const copyByLocale: Record<SiteLocale, TeamCopy> = {
  ko: {
    metadataTitle: "팀 소개 | 김동민 & Codex",
    metadataDescription: "이지컷을 함께 만드는 김동민과 AI 팀원 Codex를 소개합니다.",
    name: "김동민",
    role: "이지컷 대표",
    summary:
      "무대에서 음악을 만들고, 창작자가 콘텐츠를 세상에 내놓기까지 겪는 시간을 직접 경험해 왔습니다. 연주자와 교육자로 쌓은 현장 경험을 바탕으로, 복잡한 영상 제작을 누구나 쉽게 시작할 수 있도록 이지컷을 만들고 있습니다.",
    imageAlt: "이지컷 대표 김동민",
    codexRole: "AI 팀원 · 커피 안 마시는 개발 파트너",
    codexItems: [
      "아이디어를 코드로 만듭니다",
      "버그는 줄이고 완성도는 높입니다",
      "빠르게 만들고 계속 개선합니다",
    ],
    codexNote:
      "Codex는 OpenAI의 AI 코딩 에이전트로, 이지컷의 설계·개발·테스트에 활용하고 있습니다.",
    codexImageAlt: "OpenAI Codex AI 코딩 에이전트",
    profileGroups: [
      {
        label: "학력 · 운영",
        items: [
          "호원대학교 실용음악과 졸업",
          "전 아카데미일마레 실용음악학원 원장",
          "해군홍보단 만기전역",
        ],
      },
    ],
  },
  en: {
    metadataTitle: "Meet the Team | Kim Dong-min & Codex",
    metadataDescription: "Meet Kim Dong-min and Codex, the AI teammate building Easy Cut together.",
    name: "Kim Dong-min",
    role: "Easy Cut Representative",
    summary:
      "Kim Dong-min has experienced firsthand what it takes to create on stage and bring creative work into the world. Drawing on his experience as a performing musician and educator, he is building Easy Cut so anyone can begin video creation without being held back by complex editing.",
    imageAlt: "Kim Dong-min, representative of Easy Cut",
    codexRole: "AI Teammate · The Developer Who Skips Coffee",
    codexItems: [
      "Turns ideas into code",
      "Fewer bugs, better quality",
      "Builds fast and keeps improving",
    ],
    codexNote:
      "Codex is OpenAI's AI coding agent, used to help design, develop, and test Easy Cut.",
    codexImageAlt: "OpenAI Codex AI coding agent",
    profileGroups: [
      {
        label: "EDUCATION · LEADERSHIP",
        items: [
          "Graduated from the Department of Applied Music, Howon University",
          "Former director, Academy Ilmare Practical Music Institute",
          "Completed service in the Republic of Korea Navy promotional band",
        ],
      },
    ],
  },
  ja: {
    metadataTitle: "チーム紹介 | キム・ドンミン & Codex",
    metadataDescription: "Easy Cutを共につくるキム・ドンミンとAIチームメンバーのCodexをご紹介します。",
    name: "キム・ドンミン",
    role: "Easy Cut代表",
    summary:
      "ステージで音楽をつくり、クリエイターが作品を世に届けるまでに必要な時間を自ら経験してきました。演奏家と教育者として培った現場経験をもとに、複雑な動画制作を誰もが簡単に始められるようEasy Cutをつくっています。",
    imageAlt: "Easy Cut代表 キム・ドンミン",
    codexRole: "AIチームメンバー · コーヒーを飲まない開発パートナー",
    codexItems: [
      "アイデアをコードにします",
      "バグを減らし、完成度を高めます",
      "素早くつくり、改善を続けます",
    ],
    codexNote:
      "CodexはOpenAIのAIコーディングエージェントで、Easy Cutの設計・開発・テストに活用しています。",
    codexImageAlt: "OpenAI Codex AIコーディングエージェント",
    profileGroups: [
      {
        label: "学歴 · 運営",
        items: [
          "湖原大学校 実用音楽科 卒業",
          "元 Academy Ilmare 実用音楽学院 院長",
          "韓国海軍広報団 満期除隊",
        ],
      },
    ],
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const copy = copyByLocale[locale];

  return createPageMetadata({
    title: copy.metadataTitle,
    description: copy.metadataDescription,
    path: PAGE_PATH,
  });
}

export default async function TeamPage() {
  if (!TEAM_PAGE_VISIBLE) {
    notFound();
  }

  const [locale, user] = await Promise.all([
    getRequestLocale(),
    getAuthenticatedUser(),
  ]);
  const copy = copyByLocale[locale];
  const personData = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: copy.name,
    jobTitle: copy.role,
    description: copy.summary,
    url: `${SITE_URL}${PAGE_PATH}`,
  };

  return (
    <div className="app-shell site-chrome min-h-screen text-neutral-100">
      <StructuredData data={personData} />
      <SiteHeader>
        <AuthControls user={user ? authProfile(user) : null} next={PAGE_PATH} />
      </SiteHeader>

      <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
        <section
          className="team-member-grid grid gap-6 md:grid-cols-2"
          aria-labelledby="representative-name"
        >
          <article className="flex flex-col items-center rounded-3xl border border-white/10 bg-[#111313]/90 px-7 py-10 text-center shadow-[0_24px_70px_rgba(0,0,0,.2)] sm:px-10 sm:py-12">
            <div className="relative h-40 w-40 overflow-hidden rounded-full border-4 border-[#203b57] bg-neutral-900 sm:h-44 sm:w-44">
              <Image
                src={kimDongMinPhoto}
                alt={copy.imageAlt}
                fill
                priority
                sizes="176px"
                placeholder="blur"
                className="object-cover"
              />
            </div>
            <h1
              id="representative-name"
              className="mt-8 text-3xl font-black tracking-[-.05em] text-white"
            >
              {copy.name}
            </h1>
            <p className="mt-2 text-sm font-bold text-neutral-400">
              {copy.role}
            </p>
            {copy.profileGroups.map((group) => (
              <ul
                key={group.label}
                aria-label={group.label}
                className="mt-9 w-full space-y-5 text-left"
              >
                {group.items.map((item) => (
                  <li
                    key={item}
                    className="flex gap-4 text-sm leading-6 text-neutral-300"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-[10px] h-1 w-1 shrink-0 rounded-full bg-[#ff806e]"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ))}
          </article>

          <article className="flex flex-col items-center rounded-3xl border border-white/10 bg-[#111313]/90 px-7 py-10 text-center shadow-[0_24px_70px_rgba(0,0,0,.2)] sm:px-10 sm:py-12">
            <div className="relative h-40 w-40 overflow-hidden rounded-full border-4 border-[#203b57] bg-white sm:h-44 sm:w-44">
              <Image
                src={codexPhoto}
                alt={copy.codexImageAlt}
                fill
                priority
                sizes="176px"
                placeholder="blur"
                className="object-cover"
              />
            </div>
            <h2 className="mt-8 text-3xl font-black tracking-[-.05em] text-white">
              Codex
            </h2>
            <p className="mt-2 text-sm font-bold text-neutral-400">
              {copy.codexRole}
            </p>
            <ul className="mt-9 w-full space-y-5 text-left">
              {copy.codexItems.map((item) => (
                <li
                  key={item}
                  className="flex gap-4 text-sm leading-6 text-neutral-300"
                >
                  <span
                    aria-hidden="true"
                    className="mt-[10px] h-1 w-1 shrink-0 rounded-full bg-[#ff806e]"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
        </section>
        <p className="mx-auto mt-5 max-w-3xl text-center text-[11px] leading-5 text-neutral-600">
          {copy.codexNote}
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
