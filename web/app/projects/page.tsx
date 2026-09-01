import Link from "next/link";
import { ProjectCard } from "@/components/project-card";
import { ProjectAuthControls } from "@/components/project-login-gate";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getAllProjects, getPublicExampleJobs } from "@/lib/data";
import { getDb } from "@/lib/db";
import { createNoIndexMetadata } from "@/lib/seo";
import { authProfile, requireMvpSession } from "@/lib/session";
import { getAuthenticatedUser } from "@/lib/supabase/server";

const PAGE_PATH = "/projects";

export const dynamic = "force-dynamic";

export const metadata = createNoIndexMetadata(
  "내 프로젝트",
  "이지컷에서 만든 쇼츠 프로젝트와 진행 상태를 한곳에서 확인하세요.",
);

export default async function ProjectsPage() {
  const user = await getAuthenticatedUser();
  const db = getDb();
  const projects = user
    ? await getAllProjects(db, await requireMvpSession(user, { createIfMissing: false }))
    : await getPublicExampleJobs(db);

  return (
    <div className="app-shell site-chrome desktop-sidebar-layout flex min-h-screen flex-col text-neutral-100">
      <div className="ambient ambient-coral" aria-hidden="true" />
      <div className="ambient ambient-violet" aria-hidden="true" />
      <SiteHeader desktopSidebar>
        <ProjectAuthControls
          user={user ? authProfile(user) : null}
          next={PAGE_PATH}
          autoOpen={!user}
        />
      </SiteHeader>
      <main className="relative mx-auto w-full max-w-6xl flex-1 px-5 pb-24 pt-10 sm:px-8 sm:pt-14">
        <div className="flex flex-col gap-6 border-b border-white/10 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-[#ff9b8d]">Workspace</p>
            <h1 className="mt-3 text-3xl font-black tracking-[-0.045em] text-white sm:text-4xl">내 프로젝트</h1>
            <p className="mt-3 text-sm leading-6 text-neutral-400">만든 쇼츠와 현재 처리 상태를 한곳에서 확인할 수 있습니다.</p>
          </div>
          {user && (
            <Link href="/#workspace" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-white px-5 text-sm font-extrabold text-black transition hover:bg-neutral-200">
              새 쇼츠 만들기 <span className="ml-2" aria-hidden="true">→</span>
            </Link>
          )}
        </div>

        {!user && (
          <div className="mt-10 flex flex-col gap-6 rounded-2xl border border-white/10 bg-white/[.035] px-6 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div>
              <h2 className="text-lg font-extrabold text-white">로그인하고 내 프로젝트도 확인하세요</h2>
              <p className="mt-2 text-sm leading-6 text-neutral-400">아래 예시 작업은 바로 둘러볼 수 있고, 로그인하면 직접 만든 프로젝트도 함께 관리할 수 있습니다.</p>
            </div>
            <Link href={`/auth/sign-in?next=${encodeURIComponent(PAGE_PATH)}`} className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl bg-white px-6 text-sm font-extrabold text-black transition hover:bg-neutral-200">
              로그인하기
            </Link>
          </div>
        )}

        {projects.length ? (
          <section className="mt-10" aria-labelledby="project-list-title">
            <div className="mb-5 flex items-center gap-2">
              <h2 id="project-list-title" className="text-lg font-extrabold text-white">{user ? "전체 프로젝트" : "예시 작업"}</h2>
              <span className="text-sm text-neutral-500">({projects.length})</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => <ProjectCard key={project.id} job={project} />)}
            </div>
          </section>
        ) : user ? (
          <div className="mt-10 rounded-2xl border border-dashed border-white/15 bg-white/[.025] px-6 py-16 text-center sm:px-10">
            <h2 className="text-xl font-extrabold text-white">아직 만든 프로젝트가 없어요</h2>
            <p className="mt-3 text-sm leading-6 text-neutral-400">유튜브 링크 하나로 첫 쇼츠 프로젝트를 만들어 보세요.</p>
            <Link href="/#workspace" className="mt-7 inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-6 text-sm font-extrabold text-black transition hover:bg-neutral-200">
              첫 프로젝트 만들기
            </Link>
          </div>
        ) : (
          <div className="mt-10 rounded-2xl border border-dashed border-white/15 bg-white/[.025] px-6 py-12 text-center text-sm text-neutral-400">
            공개된 예시 작업을 준비하고 있습니다.
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
