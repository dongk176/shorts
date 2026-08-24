"use client";

import { useEffect, useId, useRef, useState } from "react";

export type CardIssuerOption = {
  value: string;
  label: string;
};

export function CardIssuerSelect({
  value,
  options,
  onChange,
  autoFocus = false,
  attention = false,
  disabled = false,
  className = "",
}: {
  value: string;
  options: CardIssuerOption[];
  onChange: (issuerCode: string) => void;
  autoFocus?: boolean;
  attention?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  useEffect(() => {
    if (!autoFocus || disabled || options.length === 0) return;
    const frame = window.requestAnimationFrame(() => triggerRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus, disabled, options.length]);

  function openAndFocus(optionIndex: number) {
    if (disabled || options.length === 0) return;
    setOpen(true);
    window.requestAnimationFrame(() => optionRefs.current[optionIndex]?.focus());
  }

  function select(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div
      ref={rootRef}
      className={`relative ${open ? "z-[80]" : "z-0"} ${className}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="카드사"
          className="absolute isolate inset-x-0 top-[calc(100%+0.5rem)] z-[90] max-h-64 overflow-y-auto rounded-2xl border border-white/12 bg-[#25282a] p-1.5 shadow-[0_20px_50px_rgba(0,0,0,.72)] ring-1 ring-black/50 sm:bottom-[calc(100%+0.5rem)] sm:top-auto sm:shadow-[0_-20px_50px_rgba(0,0,0,.72)]"
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              ref={(element) => { optionRefs.current[index] = element; }}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => select(option.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const direction = event.key === "ArrowDown" ? 1 : -1;
                  const nextIndex = (index + direction + options.length) % options.length;
                  optionRefs.current[nextIndex]?.focus();
                } else if (event.key === "Home") {
                  event.preventDefault();
                  optionRefs.current[0]?.focus();
                } else if (event.key === "End") {
                  event.preventDefault();
                  optionRefs.current[options.length - 1]?.focus();
                }
              }}
              className={`flex min-h-10 w-full items-center justify-between rounded-xl px-3 text-left text-sm font-bold transition ${
                option.value === value
                  ? "bg-[#ff715e]/14 text-[#ffad9f]"
                  : "text-neutral-200 hover:bg-white/[.07] hover:text-white"
              }`}
            >
              <span>{option.label}</span>
              {option.value === value && (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m5 10 3 3 7-7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
      <button
        ref={triggerRef}
        type="button"
        data-card-issuer-trigger
        disabled={disabled || options.length === 0}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            const selectedIndex = Math.max(
              0,
              options.findIndex((option) => option.value === value),
            );
            openAndFocus(selectedIndex);
          }
        }}
        className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-3.5 text-sm font-black outline-none transition ${
          disabled || options.length === 0
            ? "cursor-not-allowed border-white/[.06] bg-[#171a1c] text-neutral-600"
            : attention && !value
              ? "border-[#ff9b8d] bg-[#ff715e]/10 text-white shadow-[0_0_0_3px_rgba(255,113,94,.15),0_0_20px_rgba(255,113,94,.28)] motion-safe:animate-pulse"
              : open
              ? "border-[#ff8f7f]/60 bg-[#292c2e] text-white shadow-[0_0_0_3px_rgba(255,113,94,.1)]"
              : "border-white/10 bg-[#202325] text-white hover:border-white/20 hover:bg-[#25282a]"
        }`}
      >
        <span>{selectedOption?.label || "카드사를 선택해 주세요"}</span>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[.06] text-neutral-300">
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className={`h-4 w-4 transition-transform duration-200 ${
              open ? "rotate-180 sm:rotate-0" : "sm:rotate-180"
            }`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 8 4 4 4-4" />
          </svg>
        </span>
      </button>
    </div>
  );
}
