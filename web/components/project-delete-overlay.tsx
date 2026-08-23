"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

export function ProjectDeleteOverlay({
  open,
  state,
  statusLabel,
  title,
  message,
  actionLabel,
  closeLabel,
  actionPending = false,
  onAction,
  onClose,
}: {
  open: boolean;
  state: "confirm" | "success" | "error";
  statusLabel: string;
  title: string;
  message?: string;
  actionLabel?: string;
  closeLabel: string;
  actionPending?: boolean;
  onAction?: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const actionPendingRef = useRef(actionPending);
  const scrollPositionRef = useRef({ x: 0, y: 0 });
  closeRef.current = onClose;
  actionPendingRef.current = actionPending;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    scrollPositionRef.current = { x: window.scrollX, y: window.scrollY };
    const restoreScroll = () => {
      const { x, y } = scrollPositionRef.current;
      window.requestAnimationFrame(() => window.scrollTo(x, y));
    };
    const frame = window.requestAnimationFrame(() => {
      const firstControl = dialogRef.current?.querySelector<HTMLElement>(
        "[data-project-delete-autofocus]",
      );
      (firstControl || dialogRef.current)?.focus({ preventScroll: true });
      restoreScroll();
    });
    const preventViewportScroll = (event: Event) => event.preventDefault();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        ["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "].includes(event.key)
      ) {
        event.preventDefault();
      }
      if (event.key === "Escape" && !actionPendingRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex='-1'])",
        ) || [],
      );
      if (controls.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus({ preventScroll: true });
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("wheel", preventViewportScroll, { passive: false });
    document.addEventListener("touchmove", preventViewportScroll, { passive: false });
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("wheel", preventViewportScroll);
      document.removeEventListener("touchmove", preventViewportScroll);
      restoreScroll();
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const destructive = state === "confirm";
  return createPortal(
    <div
      className="fixed inset-0 z-[220] grid place-items-center bg-black/80 px-5 py-8 backdrop-blur-sm"
      style={{ touchAction: "none" }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !actionPending) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role={destructive || state === "error" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        tabIndex={-1}
        className="w-full max-w-md overflow-hidden rounded-[28px] border border-white/10 bg-[#202326] text-center shadow-[0_28px_100px_rgba(0,0,0,.72)] outline-none"
      >
        <div className="px-6 pb-7 pt-8 sm:px-8">
          <span
            aria-hidden="true"
            className={`mx-auto grid h-12 w-12 place-items-center rounded-full border text-xl font-black ${
              state === "success"
                ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-300"
                : "border-[#ff8f80]/30 bg-[#ff715e]/10 text-[#ffb4a8]"
            }`}
          >
            {state === "success" ? "✓" : "!"}
          </span>
          <p className={`mt-5 text-[11px] font-black tracking-[.18em] ${
            state === "success" ? "text-emerald-300" : "text-[#ff9b8d]"
          }`}>
            {statusLabel}
          </p>
          <h2 id={titleId} className="mt-2 text-xl font-black text-white sm:text-2xl">
            {title}
          </h2>
          {message ? (
            <p id={messageId} className="mt-4 whitespace-pre-line text-sm leading-6 text-neutral-400">
              {message}
            </p>
          ) : null}
        </div>
        <div className={`grid gap-3 border-t border-white/10 px-5 py-5 sm:px-7 ${
          actionLabel && onAction ? "grid-cols-[auto_1fr]" : "grid-cols-1"
        }`}>
          <button
            type="button"
            data-project-delete-autofocus
            disabled={actionPending}
            onClick={onClose}
            className="min-h-12 rounded-xl border border-white/10 px-5 text-sm font-extrabold text-neutral-300 transition hover:bg-white/[.06] disabled:opacity-40"
          >
            {closeLabel}
          </button>
          {actionLabel && onAction ? (
            <button
              type="button"
              disabled={actionPending}
              onClick={onAction}
              className="min-h-12 rounded-xl bg-[#ff715e] px-5 text-sm font-black text-white transition hover:bg-[#ff5f4a] disabled:cursor-wait disabled:opacity-55"
            >
              {actionPending ? "삭제 처리 중..." : actionLabel}
            </button>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}
