"use client";

import { useUiText } from "@/lib/i18n/use-ui-text";

import { useEffect, useRef, useState } from "react";

export function ContentLanguageSelect<Value extends string>({
  id,
  labelledBy,
  describedBy,
  prefix,
  value,
  options,
  onChange,
  disabled = false,
  className = "mt-3",
}: {
  id: string;
  labelledBy: string;
  describedBy?: string;
  prefix?: string;
  value: Value;
  options: readonly { value: Value; label: string }[];
  onChange: (value: Value) => void;
  disabled?: boolean;
  className?: string;
}) {
  const ui = useUiText();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const expanded = open && !disabled;
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const listboxId = `${id}-options`;
  const valueId = `${id}-value`;

  useEffect(() => {
    if (!expanded) return;
    optionRefs.current[selectedIndex]?.focus();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [expanded, selectedIndex]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function select(nextValue: Value) {
    if (disabled) return;
    onChange(nextValue);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div
      ref={rootRef}
      className={`relative ${className} ${expanded ? "z-40" : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-labelledby={`${labelledBy} ${valueId}`}
        aria-describedby={describedBy}
        aria-haspopup="listbox"
        aria-controls={expanded ? listboxId : undefined}
        aria-expanded={expanded}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!expanded && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border bg-neutral-900 px-4 py-2.5 text-left text-sm font-medium text-white outline-none transition-colors focus-visible:border-[#ff8f7f] focus-visible:ring-2 focus-visible:ring-[#ff715e]/25 disabled:cursor-not-allowed disabled:opacity-50 ${
          expanded ? "border-[#ff8f7f]/60" : "border-white/15 hover:border-white/30 hover:bg-neutral-800"
        }`}
      >
        <span className="min-w-0 truncate">{prefix && <span aria-hidden="true" className="mr-1.5 text-neutral-400">{prefix} ·</span>}<span id={valueId}>{options[selectedIndex]?.label}</span></span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform duration-150 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m5 7.5 5 5 5-5" />
        </svg>
      </button>
      {expanded && (
        <div
          id={listboxId}
          role="listbox"
          aria-labelledby={labelledBy}
          className="absolute inset-x-0 top-[calc(100%+0.5rem)] max-h-60 overflow-y-auto overscroll-contain rounded-xl border border-white/15 bg-[#202224] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,.45)]"
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              ref={(element) => { optionRefs.current[index] = element; }}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={option.value === value}
              onClick={() => select(option.value)}
              onKeyDown={(event) => {
                let nextIndex: number;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  nextIndex = (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
                } else if (event.key === "Home") {
                  nextIndex = 0;
                } else if (event.key === "End") {
                  nextIndex = options.length - 1;
                } else {
                  return;
                }
                event.preventDefault();
                optionRefs.current[nextIndex]?.focus();
              }}
              className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#ff8f7f]/60 ${
                option.value === value
                  ? "bg-[#ff715e]/10 text-[#ffad9f]"
                  : "text-neutral-200 hover:bg-white/[.07] focus-visible:bg-white/[.07]"
              }`}
            >
              <span>{ui(option.label)}</span>
              {option.value === value && (
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m4.5 10 3.5 3.5 7.5-7.5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
