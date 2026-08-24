"use client";

import { useEffect, useState } from "react";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { AuthProfile } from "@/lib/session";

const PROJECT_LOGIN_TITLE = "내 프로젝트를 확인해볼까요?";

export function ProjectAuthControls({
  user,
  next,
  autoOpen = false,
}: {
  user: AuthProfile | null;
  next: string;
  autoOpen?: boolean;
}) {
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    if (autoOpen && !user) setLoginOpen(true);
  }, [autoOpen, user]);

  return (
    <AuthControls
      user={user}
      next={next}
      loginOpen={loginOpen}
      onLoginOpenChange={setLoginOpen}
      dialogTitle={PROJECT_LOGIN_TITLE}
      dialogDescription="로그인하면 내가 만든 프로젝트를 바로 이어서 확인할 수 있어요."
    />
  );
}

export function ProjectLoginRequiredPage({
  projectNumber,
}: {
  projectNumber: number;
}) {
  const next = `/projects/${projectNumber}`;
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => setLoginOpen(true), []);

  return (
    <div className="app-shell site-chrome desktop-sidebar-layout flex min-h-screen flex-col text-neutral-100">
      <SiteHeader desktopSidebar>
        <AuthControls
          user={null}
          next={next}
          loginOpen={loginOpen}
          onLoginOpenChange={setLoginOpen}
          dialogTitle="이 프로젝트를 계속 보려면 로그인해 주세요"
          dialogDescription="로그인이 끝나면 이 프로젝트가 내 프로젝트인지 확인하고, 같은 화면으로 바로 이어드릴게요."
        />
      </SiteHeader>

      <main className="relative mx-auto grid w-full max-w-4xl flex-1 place-items-center px-5 py-20 sm:px-8">
        <section className="relative w-full overflow-hidden rounded-[28px] border border-white/10 bg-white/[.035] px-6 py-14 text-center shadow-[0_30px_90px_rgba(0,0,0,.28)] sm:px-12 sm:py-20">
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-24 -top-28 h-48 rounded-full bg-[#ff715e]/12 blur-3xl" />
          <div className="relative mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[.055] text-[#ffb4a8] shadow-[0_16px_40px_rgba(0,0,0,.3)]">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="10" width="14" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          </div>
          <p className="relative mt-7 text-[11px] font-black uppercase tracking-[.22em] text-[#ff9b8d]">
            Project /{projectNumber}
          </p>
          <h1 className="relative mt-3 text-2xl font-black tracking-[-.045em] text-white sm:text-3xl">
            로그인하면 프로젝트를 바로 확인할 수 있어요
          </h1>
          <p className="relative mx-auto mt-4 max-w-xl text-sm leading-7 text-neutral-400 sm:text-[15px]">
            내 프로젝트로 확인되면 로그인 직후 같은 페이지로 자동 이동합니다.
            다른 사람의 프로젝트 내용은 표시하지 않아요.
          </p>
          <button
            type="button"
            onClick={() => setLoginOpen(true)}
            className="relative mt-8 inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-6 text-sm font-black text-black transition hover:-translate-y-0.5 hover:bg-neutral-200"
          >
            로그인하고 프로젝트 보기 <span className="ml-2" aria-hidden="true">→</span>
          </button>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
