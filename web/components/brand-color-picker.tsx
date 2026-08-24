"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  templatePresetColorOptions,
  type TemplatePresetColor,
} from "@/lib/template-config";
import { compactBrandColorOptions } from "@/lib/brand-color-picker-options";

export function BrandColorPicker({
  value,
  onChange,
}: {
  value: TemplatePresetColor;
  onChange: (value: TemplatePresetColor) => void;
}) {
  const [open, setOpen] = useState(false);
  const pickerId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = templatePresetColorOptions.find((option) => option.color === value);
  const displayedCompactOptions = compactBrandColorOptions(value);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const colorButton = (
    option: (typeof templatePresetColorOptions)[number],
    compact = false,
    className = "",
  ) => (
    <button
      key={option.color}
      type="button"
      aria-label={`${option.name} 브랜드 컬러`}
      aria-pressed={value === option.color}
      title={option.name}
      onClick={() => {
        onChange(option.color);
        if (!compact) setOpen(false);
      }}
      className={`relative h-7 w-7 shrink-0 rounded-full border transition hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${value === option.color ? "border-white shadow-[0_0_0_3px_rgba(255,255,255,.2)]" : "border-white/20"} ${className}`}
      style={{ backgroundColor: option.color }}
    >
      {value === option.color && (
        <span className="absolute inset-0 grid place-items-center text-[12px] font-black text-white [text-shadow:0_1px_3px_rgba(0,0,0,.9)]" aria-hidden="true">✓</span>
      )}
    </button>
  );

  return (
    <fieldset className="w-full min-w-0">
      <legend className="sr-only">브랜드 컬러</legend>
      <div ref={rootRef} className="relative grid min-w-0 grid-cols-[72px_minmax(0,1fr)] items-center gap-3">
        <span className="w-[72px] shrink-0 text-xs font-semibold text-neutral-400">브랜드 컬러</span>
        <div className="flex min-w-0 max-w-full items-center gap-2">
          {displayedCompactOptions.map((option, index) => colorButton(
            option,
            true,
            index === displayedCompactOptions.length - 1
              ? "hidden min-[420px]:inline-flex"
              : "",
          ))}
          <button
            type="button"
            aria-label="브랜드 컬러 더 보기"
            aria-expanded={open}
            aria-controls={pickerId}
            title="더 많은 브랜드 컬러 보기"
            onClick={() => setOpen((current) => !current)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[.06] text-base font-bold leading-none text-white transition hover:border-white/35 hover:bg-white/[.11]"
          >
            {open ? "−" : "+"}
          </button>
          <span className="hidden truncate text-[11px] font-semibold text-neutral-500 sm:block">{selected?.name}</span>
        </div>
        {open && (
          <div
            id={pickerId}
            role="group"
            aria-label="전체 브랜드 컬러"
            className="absolute left-0 top-[calc(100%+10px)] z-40 grid max-w-[calc(100vw-64px)] grid-cols-5 gap-2 rounded-xl border border-white/15 bg-[#171719]/95 p-3 shadow-2xl backdrop-blur-xl sm:left-[84px] sm:grid-cols-6"
          >
            {templatePresetColorOptions.map((option) => colorButton(option))}
          </div>
        )}
      </div>
    </fieldset>
  );
}
