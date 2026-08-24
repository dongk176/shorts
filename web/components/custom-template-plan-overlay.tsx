"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function CustomTemplatePlanOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pricingRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    const frame = window.requestAnimationFrame(() => pricingRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-template-plan-title"
        aria-describedby="custom-template-plan-description"
        className="w-full max-w-[440px] rounded-[26px] border border-[#ff9b8d]/20 bg-[#202124] p-7 text-center shadow-[0_32px_100px_rgba(0,0,0,.72),0_0_48px_rgba(255,113,94,.1)] sm:p-9"
      >
        <p className="text-[11px] font-black uppercase tracking-[.18em] text-[#ff9b8d]">Easy Cut Paid</p>
        <h2 id="custom-template-plan-title" className="mt-3 text-2xl font-black tracking-[-.04em] text-white">
          커스텀 템플릿을 저장하려면<br />유료 이용권이 필요해요
        </h2>
        <p id="custom-template-plan-description" className="mt-4 text-sm leading-6 text-neutral-400">
          이지컷 프로 또는 기간 패키지를 이용하면<br />직접 만든 템플릿을 저장하고 사용할 수 있어요.
        </p>
        <div className="mt-7 grid gap-2.5">
          <Link
            ref={pricingRef}
            href="/pricing"
            className="flex min-h-12 items-center justify-center rounded-xl bg-[#ff715e] px-5 text-sm font-black text-white transition hover:bg-[#ff8a78]"
          >
            요금제 확인하기
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl border border-white/10 px-5 text-sm font-bold text-neutral-300 transition hover:border-white/25 hover:text-white"
          >
            계속 편집하기
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
