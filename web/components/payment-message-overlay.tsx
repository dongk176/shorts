"use client";

import Link from "next/link";
import { useEffect, useId, useRef, type ReactNode } from "react";

export type PaymentMessageTone = "success" | "error" | "info";

type PaymentMessageOverlayProps = {
  open: boolean;
  tone: PaymentMessageTone;
  title: string;
  message: string;
  onClose?: () => void;
  closeLabel?: string;
  actionHref?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionPending?: boolean;
  pendingLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  highlight?: ReactNode;
  showStatus?: boolean;
};

const toneStyles: Record<PaymentMessageTone, {
  icon: string;
  iconClassName: string;
  eyebrow: string;
  eyebrowClassName: string;
}> = {
  success: {
    icon: "✓",
    iconClassName: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200",
    eyebrow: "처리 완료",
    eyebrowClassName: "text-emerald-300",
  },
  error: {
    icon: "!",
    iconClassName: "border-red-300/25 bg-red-400/10 text-red-200",
    eyebrow: "확인 필요",
    eyebrowClassName: "text-red-300",
  },
  info: {
    icon: "…",
    iconClassName: "border-sky-300/25 bg-sky-300/10 text-sky-200",
    eyebrow: "처리 중",
    eyebrowClassName: "text-sky-300",
  },
};

export function PaymentMessageOverlay({
  open,
  tone,
  title,
  message,
  onClose,
  closeLabel = "확인",
  actionHref,
  actionLabel,
  onAction,
  actionPending = false,
  pendingLabel = "처리 중...",
  secondaryHref,
  secondaryLabel,
  highlight,
  showStatus = true,
}: PaymentMessageOverlayProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeHandlerRef = useRef(onClose);
  closeHandlerRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => {
      const firstControl = dialogRef.current?.querySelector<HTMLElement>("[data-overlay-autofocus]");
      (firstControl || dialogRef.current)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeHandlerRef.current) {
        event.preventDefault();
        closeHandlerRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (controls.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
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
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  const styles = toneStyles[tone];
  return (
    <div
      className="fixed inset-0 z-[200] grid place-items-center overflow-y-auto bg-black/80 px-5 py-8 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeHandlerRef.current?.();
      }}
    >
      <section
        ref={dialogRef}
        role={tone === "error" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? descriptionId : undefined}
        aria-busy={actionPending}
        tabIndex={-1}
        className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-white/10 bg-[#202124] p-7 text-center text-neutral-100 shadow-[0_32px_100px_rgba(0,0,0,.72),0_0_54px_rgba(255,113,94,.08)] outline-none sm:p-9"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-14 -top-24 h-40 rounded-full bg-[#ff715e]/10 blur-3xl" />
        {showStatus ? (
          <>
            <div
              aria-hidden="true"
              className={`relative mx-auto grid h-12 w-12 place-items-center rounded-full border text-xl font-black ${styles.iconClassName}`}
            >
              {styles.icon}
            </div>
            <p className={`relative mt-5 text-[11px] font-black uppercase tracking-[.18em] ${styles.eyebrowClassName}`}>
              {styles.eyebrow}
            </p>
          </>
        ) : null}
        <h1 id={titleId} className={`relative whitespace-pre-line text-2xl font-black tracking-[-.04em] text-white ${showStatus ? "mt-2" : ""}`}>
          {title}
        </h1>
        {highlight}
        {message ? (
          <p id={descriptionId} className="relative mt-4 whitespace-pre-line text-sm leading-6 text-neutral-300">
            {message}
          </p>
        ) : null}
        <div className="relative mt-7 grid gap-2.5">
          {actionPending ? (
            <span
              data-overlay-autofocus
              tabIndex={-1}
              className="flex min-h-12 items-center justify-center rounded-xl bg-white/8 px-5 text-sm font-extrabold text-neutral-300 outline-none"
            >
              {pendingLabel}
            </span>
          ) : actionHref && actionLabel ? (
            <Link
              data-overlay-autofocus
              href={actionHref}
              prefetch={false}
              className="flex min-h-12 items-center justify-center rounded-xl bg-[#ff715e] px-5 text-sm font-extrabold text-white transition hover:bg-[#ff806f]"
            >
              {actionLabel}
            </Link>
          ) : onAction && actionLabel ? (
            <button
              data-overlay-autofocus
              type="button"
              onClick={onAction}
              className="min-h-12 rounded-xl bg-[#ff715e] px-5 text-sm font-extrabold text-white transition hover:bg-[#ff806f]"
            >
              {actionLabel}
            </button>
          ) : onClose ? (
            <button
              data-overlay-autofocus
              type="button"
              onClick={onClose}
              className="min-h-12 rounded-xl bg-[#ff715e] px-5 text-sm font-extrabold text-white transition hover:bg-[#ff806f]"
            >
              {closeLabel}
            </button>
          ) : null}
          {!actionPending && secondaryHref && secondaryLabel && (
            <Link
              href={secondaryHref}
              prefetch={false}
              className="flex min-h-11 items-center justify-center rounded-xl border border-white/10 px-5 text-xs font-bold text-white transition hover:border-white/25"
            >
              {secondaryLabel}
            </Link>
          )}
          {!actionPending && (actionHref || onAction) && actionLabel && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-xl border border-white/10 px-5 text-xs font-bold text-neutral-300 transition hover:border-white/25 hover:text-white"
            >
              {closeLabel}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
