"use client";

import { useEffect, useRef, useState } from "react";
import { ContentLanguageSelect } from "@/components/content-language-select";

/** Desktop listbox and a touch-sized custom sheet; never opens the OS select UI. */
export function PopularFilterSelect<Value extends string>({
  id, label, value, options, onChange, closeLabel, showLabel = false, className = "",
}: {
  id: string;
  label: string;
  value: Value;
  options: readonly { value: Value; label: string }[];
  onChange: (value: Value) => void;
  closeLabel: string;
  showLabel?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));
  const selected = options[selectedIndex];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    optionRefs.current[selectedIndex]?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open, selectedIndex]);

  return <div className={className}>
    <span id={`${id}-label`} className="sr-only">{label}</span>
    <div className="hidden md:block">
      <ContentLanguageSelect id={id} labelledBy={`${id}-label`} value={value} options={options}
        onChange={onChange} prefix={showLabel ? label : undefined} className="" />
    </div>
    <button ref={triggerRef} id={`${id}-mobile`} type="button" aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? `${id}-sheet` : undefined} aria-label={`${label} · ${selected?.label}`}
      onClick={() => setOpen(true)}
      className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-white/15 bg-[#202628] px-3.5 py-3 text-left text-sm font-semibold text-white outline-none transition hover:border-white/30 focus-visible:ring-2 focus-visible:ring-[#ff715e] md:hidden">
      <span className="min-w-0 truncate">{showLabel && <span className="mr-1.5 text-neutral-400">{label} ·</span>}{selected?.label}</span>
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 shrink-0 text-neutral-400"><path d="m5 7.5 5 5 5-5" /></svg>
    </button>
    {open && <dialog ref={dialogRef} id={`${id}-sheet`} aria-modal="true" aria-labelledby={`${id}-sheet-title`}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); }}
      onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-3xl border border-white/10 bg-[#15191a] p-0 text-white shadow-2xl backdrop:bg-black/70">
      <div className="px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3" onClick={event => event.stopPropagation()}>
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/20" aria-hidden="true" />
        <header className="mb-3 flex items-center justify-between gap-3 px-1">
          <h2 id={`${id}-sheet-title`} className="text-lg font-bold">{label}</h2>
          <button type="button" aria-label={closeLabel} onClick={() => setOpen(false)} className="grid h-11 w-11 place-items-center rounded-xl text-2xl text-neutral-400 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ff715e]">×</button>
        </header>
        <div role="listbox" aria-labelledby={`${id}-sheet-title`} className="space-y-1">
          {options.map((option, index) => <button key={option.value} type="button" role="option"
            ref={element => { optionRefs.current[index] = element; }}
            tabIndex={option.value === value ? 0 : -1} aria-selected={option.value === value}
            onClick={() => { onChange(option.value); setOpen(false); }}
            onKeyDown={event => {
              let next: number;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") next = (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = options.length - 1;
              else return;
              event.preventDefault(); optionRefs.current[next]?.focus();
            }}
            className={`flex min-h-14 w-full items-center justify-between gap-4 rounded-xl px-4 py-3 text-left text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#ff715e] ${option.value === value ? "bg-[#ff715e]/10 text-[#ffad9f]" : "text-neutral-200 hover:bg-white/5"}`}>
            {option.label}
            {option.value === value && <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 shrink-0"><path d="m4.5 10 3.5 3.5 7.5-7.5" /></svg>}
          </button>)}
        </div>
      </div>
    </dialog>}
  </div>;
}
