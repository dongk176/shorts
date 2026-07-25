"use client";

import { useEffect, useId, useRef, useState } from "react";

function installmentLabel(months: number) {
  return months === 0 ? "일시불" : `${months}개월 할부`;
}

export function InstallmentSelect({
  value,
  months,
  onChange,
  className = "",
}: {
  value: number;
  months: number[];
  onChange: (months: number) => void;
  className?: string;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const options = [0, ...new Set(months)].sort((left, right) => left - right);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  function openAndFocus(optionIndex: number) {
    setOpen(true);
    window.requestAnimationFrame(() => optionRefs.current[optionIndex]?.focus());
  }

  function select(nextValue: number) {
    onChange(nextValue);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div
      ref={rootRef}
      className={`relative ${className}`}
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
          aria-label="결제 방식"
          className="absolute inset-x-0 bottom-[calc(100%+0.5rem)] z-50 max-h-60 overflow-y-auto rounded-2xl border border-white/12 bg-[#25282a]/98 p-1.5 shadow-[0_20px_50px_rgba(0,0,0,.55)] backdrop-blur-xl"
        >
          {options.map((option, index) => (
            <button
              key={option}
              ref={(element) => { optionRefs.current[index] = element; }}
              type="button"
              role="option"
              aria-selected={option === value}
              onClick={() => select(option)}
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
                option === value
                  ? "bg-[#ff715e]/14 text-[#ffad9f]"
                  : "text-neutral-200 hover:bg-white/[.07] hover:text-white"
              }`}
            >
              <span>{installmentLabel(option)}</span>
              {option === value && (
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
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
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            const selectedIndex = Math.max(0, options.indexOf(value));
            openAndFocus(selectedIndex);
          }
        }}
        className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-3.5 text-sm font-black text-white outline-none transition ${
          open
            ? "border-[#ff8f7f]/60 bg-[#292c2e] shadow-[0_0_0_3px_rgba(255,113,94,.1)]"
            : "border-white/10 bg-[#202325] hover:border-white/20 hover:bg-[#25282a]"
        }`}
      >
        <span>{installmentLabel(value)}</span>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[.06] text-neutral-300">
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
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
