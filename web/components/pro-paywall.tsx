"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ProPaywallStep = "closed" | "notice" | "pricing";

export function ProPaywall({
  step,
  onStepChange,
}: {
  step: ProPaywallStep;
  onStepChange: (step: ProPaywallStep) => void;
  isAuthenticated: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const confirmRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (step === "closed") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onStepChange("closed");
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onStepChange, step]);

  useEffect(() => {
    if (step === "notice") {
      const frame = window.requestAnimationFrame(() => confirmRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
  }, [step]);

  if (!mounted || step === "closed") return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center md:items-center md:p-6">
      <button
        type="button"
        aria-label="오버레이 닫기"
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={() => onStepChange("closed")}
      />
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pro-notice-title"
        aria-describedby="pro-notice-description"
        className="login-dialog relative mb-[max(20px,env(safe-area-inset-bottom))] w-[calc(100%-32px)] max-w-[420px] overflow-hidden rounded-[24px] border border-violet-300/20 bg-[#202426] px-6 pb-6 pt-7 text-center shadow-[0_30px_100px_rgba(0,0,0,.7),0_0_44px_rgba(160,120,255,.13)] md:mb-0 md:px-8 md:pb-8 md:pt-9"
      >
        <Image className="mx-auto" src="/east-cut-logo.png" alt="" width={40} height={40} aria-hidden="true" />
        <h2 id="pro-notice-title" className="mt-5 text-[21px] font-black tracking-[-.035em] text-white md:text-2xl">
          해당 기능은 유료 이용권이 필요해요
        </h2>
        <p id="pro-notice-description" className="mx-auto mt-3 max-w-sm text-sm leading-6 text-neutral-400">
          이지컷 프로 구독 또는 사용 목적에 맞는 패키지를 선택해 주세요.
        </p>
        <Link
          ref={confirmRef}
          href="/pricing"
          className="mt-7 flex min-h-12 w-full items-center justify-center rounded-xl bg-[#f04435] px-5 text-sm font-extrabold text-white shadow-[0_12px_30px_rgba(240,68,53,.24)] transition hover:bg-[#ff5d4d]"
        >
          요금제 보기
        </Link>
        <button
          type="button"
          onClick={() => onStepChange("closed")}
          className="mt-3 min-h-11 w-full rounded-xl border border-white/10 text-sm font-bold text-neutral-400 transition hover:bg-white/[.05] hover:text-white"
        >
          닫기
        </button>
      </section>
    </div>,
    document.body,
  );
}
