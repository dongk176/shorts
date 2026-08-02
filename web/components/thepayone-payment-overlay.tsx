"use client";

import Image from "next/image";
import {
  useEffect,
  useId,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { advancePaymentFocusIfComplete } from "@/lib/payment-focus";

export function ThePayOnePaymentOverlay({
  title,
  busy,
  primaryLabel,
  primaryDisabled = false,
  secondaryLabel,
  onPrimaryClick,
  onClose,
  onSecondary,
  onSubmit,
  children,
}: {
  title?: string | null;
  busy: boolean;
  primaryLabel: string;
  primaryDisabled?: boolean;
  secondaryLabel?: string;
  onPrimaryClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onClose: () => void;
  onSecondary?: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.body.style.overflow = "hidden";
    document.body.classList.add("purchase-sheet-open");

    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("[data-payment-autofocus]")?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.classList.remove("purchase-sheet-open");
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end bg-black/80 pt-8 backdrop-blur-md sm:grid sm:place-items-center sm:overflow-y-auto sm:px-5 sm:py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-label={title ? undefined : "더페이원 결제"}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        ref={dialogRef}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        onInput={(event) => advancePaymentFocusIfComplete(event.target)}
        className="thepayone-payment-dialog relative flex h-[calc(100svh-0.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-t-[30px] border border-[#ff8f80]/20 bg-[#181b1d] shadow-[0_30px_100px_rgba(0,0,0,.72),0_0_70px_rgba(255,113,94,.08)] sm:h-auto sm:max-h-[calc(100dvh-4rem)] sm:rounded-[30px]"
      >
        <div className="pointer-events-none absolute inset-x-20 -top-24 h-44 rounded-full bg-[#ff715e]/10 blur-3xl" />
        <div className="thepayone-payment-content relative min-h-0 flex-1 overflow-y-auto px-5 pb-7 pt-3 sm:flex-auto sm:px-8 sm:pt-8">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20 sm:hidden" aria-hidden="true" />
          <div className="flex items-center justify-between gap-5">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-white">
                <Image
                  src="/thepayone-mark.png"
                  alt=""
                  width={30}
                  height={38}
                  className="h-8 w-auto object-contain"
                />
              </span>
              <strong className="text-lg font-black tracking-[-.03em] text-white sm:text-xl">
                더페이원
              </strong>
            </div>
            <button
              type="button"
              aria-label="결제창 닫기"
              disabled={busy}
              onClick={onClose}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 text-xl text-neutral-400 transition hover:border-white/20 hover:bg-white/[.06] hover:text-white disabled:opacity-40"
            >
              ×
            </button>
          </div>
          {title && (
            <h2 id={titleId} className="mt-7 text-[28px] font-black tracking-[-.04em] text-white">
              {title}
            </h2>
          )}
          {children}
        </div>

        <div className={`sticky bottom-0 z-10 grid flex-none gap-3 border-t border-white/10 bg-[#181b1d]/98 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8 ${
          secondaryLabel ? "grid-cols-[auto_1fr]" : "grid-cols-1"
        }`}>
          {secondaryLabel && (
            <button
              type="button"
              disabled={busy}
              onClick={onSecondary || onClose}
              className="min-h-[52px] rounded-xl border border-white/10 px-5 text-sm font-bold text-neutral-300 transition hover:border-white/20 hover:text-white disabled:opacity-40"
            >
              {secondaryLabel}
            </button>
          )}
          <button
            type="submit"
            disabled={busy || primaryDisabled}
            onClick={onPrimaryClick}
            className="min-h-[52px] w-full rounded-xl bg-gradient-to-r from-[#ef4939] to-[#ff715e] px-5 text-sm font-black text-white shadow-[0_12px_30px_rgba(239,73,57,.22)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {primaryLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
