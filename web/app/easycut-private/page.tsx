import type { Metadata } from "next";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { authProfile } from "@/lib/session";
import { createPageMetadata } from "@/lib/seo";
import { getAuthenticatedUser } from "@/lib/supabase/server";

const PAGE_PATH = "/easycut-private";
const OPEN_CHAT_URL = "https://open.kakao.com/o/gBO91xHi";

export const metadata: Metadata = createPageMetadata({
  title: "EASYCUT PRIVATE | 이지컷",
  description:
    "퀄리티 높은 재사용 허용 영상과 쇼츠 제작 인사이트, 이지컷의 새로운 기능과 소식을 가장 먼저 만나는 Private Channel입니다.",
  path: PAGE_PATH,
});

const privateBenefits = [
  {
    key: "source",
    label: "영상 큐레이션",
    title: "바로 활용할 수 있는 좋은 소스",
    description: "대표가 직접 고른 재사용 허용 영상을 선별해 공유합니다.",
  },
  {
    key: "notes",
    label: "제작 노트",
    title: "쇼츠를 더 잘 만드는 방법",
    description: "제작과 운영에 바로 적용할 수 있는 팁과 노하우를 전해드립니다.",
  },
  {
    key: "updates",
    label: "업데이트",
    title: "새 기능을 가장 먼저",
    description: "새로운 기능과 주요 소식을 일반 공개 전에 알려드립니다.",
  },
] as const;

type PrivateBenefitKey = (typeof privateBenefits)[number]["key"];

function PrivateBenefitIcon({ type }: { type: PrivateBenefitKey }) {
  if (type === "source") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect className="easycut-private-icon-soft" x="2.75" y="4" width="18.5" height="16" rx="4" />
        <rect x="3.5" y="4.75" width="17" height="14.5" rx="3.25" />
        <path className="easycut-private-icon-solid" d="m10 8.8 5.15 3.2L10 15.2V8.8Z" />
        <path d="M7 16.5h1.25M15.75 16.5H17" />
      </svg>
    );
  }

  if (type === "notes") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path className="easycut-private-icon-soft" d="M4 3.75h11.2l3.3 3.35v12.4A1.5 1.5 0 0 1 17 21H5.5A1.5 1.5 0 0 1 4 19.5V3.75Z" />
        <path d="M4.75 4.5h9.8l3.2 3.2v4.05M14.25 4.75V8h3.25M8 9.75h5M8 13h3.25" />
        <path className="easycut-private-icon-solid" d="m12.55 17.9.48-2.18 4.02-4.02a1.28 1.28 0 0 1 1.8 0l.45.45a1.28 1.28 0 0 1 0 1.8l-4.02 4.02-2.18.48a.46.46 0 0 1-.55-.55Z" />
        <path className="easycut-private-icon-detail" d="m16.35 12.4 2.25 2.25" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="easycut-private-icon-soft" d="M5.35 15.4h13.3l-1.8-2.65V9.8a4.85 4.85 0 0 0-9.7 0v2.95L5.35 15.4Z" />
      <path d="M5 16.25h14l-2.15-3.5V9.8a4.85 4.85 0 0 0-9.7 0v2.95L5 16.25ZM9.75 19a2.45 2.45 0 0 0 4.5 0" />
      <path className="easycut-private-icon-solid" d="M10.65 4.3a1.35 1.35 0 0 1 2.7 0v.85h-2.7V4.3Z" />
      <path d="M18.5 5.5 20 4M19.5 8.25h2M5.5 5.5 4 4M4.5 8.25h-2" />
    </svg>
  );
}

export default async function EasycutPrivatePage() {
  const user = await getAuthenticatedUser();

  return (
    <div className="app-shell site-chrome desktop-sidebar-layout easycut-private-page flex min-h-screen flex-col text-neutral-100">
      <SiteHeader desktopSidebar>
        <AuthControls
          user={user ? authProfile(user) : null}
          next={PAGE_PATH}
        />
      </SiteHeader>

      <main className="relative flex flex-1 px-5 py-14 sm:px-8 sm:py-20">
        <section className="hero mx-auto w-full max-w-[1080px]">
          <div className="max-w-[760px]">
            <h1 className="text-[clamp(1.85rem,3.3vw,2.5rem)] font-black leading-[1.2] tracking-[-.05em] text-white">
              이지컷의 좋은 것들을<br />
              조금 먼저 공유합니다.
            </h1>

            <div className="mt-7 space-y-5 text-[15px] leading-7 text-[#aeb2b5] sm:text-base sm:leading-8">
              <p>
                EASYCUT PRIVATE에서는 대표가 직접 고른 재사용 허용 영상부터 쇼츠 제작에 도움 되는 팁과 노하우까지 공유합니다.
              </p>
              <p>
                새로운 기능, 업데이트, 주요 소식도 일반 공개 전에 가장 먼저 받아보실 수 있어요.
              </p>
              <p>
                이지컷을 제대로 활용하고 싶다면, 여기서 먼저 확인해보세요.
              </p>
            </div>

            <a
              href={OPEN_CHAT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="easycut-private-entry mt-9 inline-flex min-h-[52px] items-center justify-center rounded-xl px-7 text-base font-black tracking-[.02em] text-white"
            >
              채팅방 입장
            </a>
          </div>

          <div className="easycut-private-board">
            <div className="easycut-private-board-heading">
              <h2>PRIVATE에서 먼저 받아보는 것</h2>
              <p>필요한 정보만 골라, 일반 공개보다 조금 먼저 전해드립니다.</p>
            </div>

            <div className="easycut-private-board-grid">
              {privateBenefits.map((benefit) => (
                <article
                  key={benefit.key}
                  className={`easycut-private-benefit easycut-private-benefit-${benefit.key}`}
                >
                  <div className="easycut-private-benefit-icon">
                    <PrivateBenefitIcon type={benefit.key} />
                  </div>
                  {benefit.key === "source" ? (
                    <div className="easycut-private-source-preview" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </div>
                  ) : null}
                  <div className="easycut-private-benefit-copy">
                    <span>{benefit.label}</span>
                    <h3>{benefit.title}</h3>
                    <p>{benefit.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
