"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function PopularFiltersPlanOverlay({
  open,
  isAuthenticated,
  feature = "filters",
  onClose,
  onRequireLogin,
}: {
  open: boolean;
  isAuthenticated: boolean;
  feature?: "filters" | "more";
  onClose: () => void;
  onRequireLogin: () => void;
}) {
  const confirmRef = useRef<HTMLAnchorElement | HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    const frame = window.requestAnimationFrame(() => confirmRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  const isLoadMore = feature === "more";
  const title = isLoadMore ? "인기 영상 더 보기 안내" : "실시간 인기 필터 이용 안내";
  const description = isAuthenticated
    ? isLoadMore
      ? "더 많은 인기 영상은 구독 또는 기간 패키지가 활성화되어 있을 때 볼 수 있어요."
      : "해당 기능은 구독 또는 기간 패키지가 활성화되어 있을 때 사용할 수 있어요."
    : isLoadMore
      ? "로그인하고 구독 또는 기간 패키지를 활성화하면 더 많은 인기 영상을 볼 수 있어요."
      : "로그인하고 구독 또는 기간 패키지를 활성화하면 해당 기능을 사용할 수 있어요.";
  const actionLabel = isAuthenticated ? "이용권 확인하기" : "로그인하기";

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="popular-filter-plan-title"
        aria-describedby="popular-filter-plan-description"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          if (event.shiftKey && document.activeElement === confirmRef.current) {
            event.preventDefault();
            closeRef.current?.focus();
          } else if (!event.shiftKey && document.activeElement === closeRef.current) {
            event.preventDefault();
            confirmRef.current?.focus();
          }
        }}
        className="relative w-full max-w-[440px] overflow-hidden rounded-[26px] border border-[#ff9b8d]/20 bg-[#202124] p-7 text-center shadow-[0_32px_100px_rgba(0,0,0,.72),0_0_48px_rgba(255,113,94,.1)] sm:p-9"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-16 -top-24 h-40 rounded-full bg-[#ff715e]/15 blur-3xl" />
        <div aria-hidden="true" className="relative mx-auto grid h-12 w-12 place-items-center rounded-full border border-[#ff9b8d]/25 bg-[#ff715e]/10 text-xl text-[#ffc4bb]">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="5" y="10" width="14" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
        </div>
        <p className="relative mt-5 text-[11px] font-black uppercase tracking-[.18em] text-[#ff9b8d]">Easy Cut Paid</p>
        <h2 id="popular-filter-plan-title" className="relative mt-2 text-2xl font-black tracking-[-.04em] text-white">
          {title}
        </h2>
        <p id="popular-filter-plan-description" className="relative mt-4 text-sm leading-6 text-neutral-400">
          {description}
        </p>
        <div className="relative mt-7 grid gap-2.5">
          {isAuthenticated ? (
            <Link
              ref={(element) => {
                confirmRef.current = element;
              }}
              href="/pricing"
              className="flex min-h-12 items-center justify-center rounded-xl bg-[#ff715e] px-5 text-sm font-black text-white transition hover:bg-[#ff8a78] active:scale-[.99]"
            >
              {actionLabel}
            </Link>
          ) : (
            <button
              ref={(element) => {
                confirmRef.current = element;
              }}
              type="button"
              onClick={() => {
                onClose();
                onRequireLogin();
              }}
              className="flex min-h-12 items-center justify-center rounded-xl bg-[#ff715e] px-5 text-sm font-black text-white transition hover:bg-[#ff8a78] active:scale-[.99]"
            >
              {actionLabel}
            </button>
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl border border-white/10 px-5 text-sm font-bold text-neutral-300 transition hover:border-white/25 hover:text-white"
          >
            닫기
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
