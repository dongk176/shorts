"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { AuthProfile } from "@/lib/session";

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.36l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.39 13.93A6 6 0 0 1 6.08 12c0-.67.12-1.32.31-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.55l3.35-2.62Z" />
      <path fill="#EA4335" d="M12 5.94c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z" />
    </svg>
  );
}

function KakaoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none">
      <path
        fill="#191919"
        d="M12 3C6.477 3 2 6.57 2 10.975c0 2.857 1.879 5.362 4.703 6.772l-.956 3.503c-.085.31.27.557.54.376l4.19-2.793c.496.077 1.005.117 1.523.117 5.523 0 10-3.57 10-7.975S17.523 3 12 3Z"
      />
    </svg>
  );
}

const loginProviders = [
  {
    id: "google",
    label: "구글로 시작하기",
    Icon: GoogleIcon,
    className: "bg-white text-[#171717] hover:bg-[#f3f3f3]",
  },
  {
    id: "kakao",
    label: "카카오로 시작하기",
    Icon: KakaoIcon,
    className: "bg-[#FEE500] text-[#191919] hover:bg-[#f4dc00]",
  },
] as const;

export function AuthControls({
  user,
  next = "/",
  loginOpen: controlledLoginOpen,
  onLoginOpenChange,
}: {
  user: AuthProfile | null;
  next?: string;
  loginOpen?: boolean;
  onLoginOpenChange?: (open: boolean) => void;
}) {
  const [internalLoginOpen, setInternalLoginOpen] = useState(false);
  const loginOpen = controlledLoginOpen ?? internalLoginOpen;
  const setLoginOpen = useCallback((open: boolean) => {
    if (controlledLoginOpen === undefined) setInternalLoginOpen(open);
    onLoginOpenChange?.(open);
  }, [controlledLoginOpen, onLoginOpenChange]);

  useEffect(() => {
    if (!loginOpen || user) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLoginOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [loginOpen, setLoginOpen, user]);

  if (!user) {
    return (
      <>
        <button type="button" className="header-cta" onClick={() => setLoginOpen(true)}>
          로그인 <span aria-hidden="true">→</span>
        </button>
        {loginOpen && createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px] sm:p-6"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setLoginOpen(false);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="login-dialog-title"
              aria-describedby="login-dialog-description"
              className="login-dialog relative w-full max-w-[440px] overflow-hidden rounded-[24px] border border-white/10 bg-[#272a2c] px-7 pb-9 pt-10 shadow-[0_28px_90px_rgba(0,0,0,.62),0_0_42px_rgba(255,85,64,.12)] sm:px-8 sm:pb-10"
            >
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-16 -top-24 h-40 rounded-full bg-[#ff5540]/10 blur-3xl" />
              <button
                type="button"
                autoFocus
                onClick={() => setLoginOpen(false)}
                className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-[#b9a3a0] transition hover:bg-white/10 hover:text-white active:scale-95"
                aria-label="로그인 창 닫기"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
              <div className="relative text-center">
                <div className="mb-7 text-[30px] font-black tracking-[-0.055em] text-[#ffb4a8]">
                  Easy <span className="italic text-[#ff715e]">Cut</span>
                </div>
                <h2 id="login-dialog-title" className="text-2xl font-extrabold tracking-[-0.025em] text-[#f3f5f6]">로그인</h2>
                <p id="login-dialog-description" className="sr-only">
                  소셜 계정으로 로그인하고 프로젝트와 완성된 쇼츠를 관리하세요.
                </p>
                <div className="mt-8 space-y-4">
                  {loginProviders.map((provider) => (
                    <a
                      key={provider.id}
                      href={`/auth/sign-in?provider=${provider.id}&next=${encodeURIComponent(next)}`}
                      className={`flex min-h-14 w-full items-center justify-center gap-3 rounded-xl px-5 text-[15px] font-bold shadow-[0_6px_18px_rgba(0,0,0,.16)] transition duration-200 active:scale-[.98] ${provider.className}`}
                    >
                      <provider.Icon />
                      {provider.label}
                    </a>
                  ))}
                </div>
                <p className="mt-7 text-center text-[11px] leading-5 text-[#b19a96]">
                  로그인함으로써 <a href="/terms" className="underline underline-offset-2 hover:text-white">서비스 이용약관</a> 및 <a href="/privacy" className="underline underline-offset-2 hover:text-white">개인정보처리방침</a>에 동의합니다.
                </p>
              </div>
            </section>
          </div>,
          document.body,
        )}
      </>
    );
  }
  const label = user.displayName || user.email || "내 계정";
  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-40 truncate text-xs font-semibold text-neutral-300 sm:block" title={user.email || label}>{label}</span>
      <form action="/auth/sign-out" method="post">
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="header-cta">로그아웃</button>
      </form>
    </div>
  );
}
