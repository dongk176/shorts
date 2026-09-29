"use client";

import { useEffect, useRef, useState } from "react";
import "./publishing-select.css";

/** Kept inside the upload dialog so its focus trap and modal layer also contain the menu. */
export function PublishingSelect<Value extends string>({ id, label, value, options, onChange, disabled = false, required = false, describedBy }: {
  id: string;
  label: string;
  value: Value;
  options: readonly { value: Value; label: string }[];
  onChange: (value: Value) => void;
  disabled?: boolean;
  required?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState({ above: false, height: 240 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));
  const expanded = open && !disabled;

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!expanded) return;
    optionRefs.current[selectedIndex]?.focus({ preventScroll: true });
    const place = () => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      const dialogRect = root.current?.closest("dialog")?.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = Math.max(viewport?.offsetTop || 0, dialogRect?.top || 0);
      const bottom = Math.min((viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight), dialogRect?.bottom || window.innerHeight);
      const below = bottom - rect.bottom - 12;
      const above = rect.top - top - 12;
      const opensAbove = below < Math.min(options.length * 48 + 12, 240) && above > below;
      setPlacement({ above: opensAbove, height: Math.max(48, Math.min(240, opensAbove ? above : below)) });
    };
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const scroll = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) place();
    };
    place();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [expanded, selectedIndex, options.length]);

  function choose(next: Value) {
    if (disabled) return;
    onChange(next);
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  return <div ref={root} className={`publishing-select${expanded ? " is-open" : ""}`}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => {
      if (expanded && event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus({ preventScroll: true });
      }
    }}>
    <button ref={trigger} id={id} type="button" role="combobox" aria-label={label}
      aria-describedby={describedBy} aria-required={required || undefined}
      aria-expanded={expanded} aria-controls={expanded ? `${id}-options` : undefined} aria-haspopup="listbox"
      disabled={disabled} className={`publishing-select-trigger${value === "" ? " is-placeholder" : ""}`}
      onClick={() => setOpen(current => !current)}
      onKeyDown={event => {
        if (!expanded && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault(); setOpen(true);
        }
      }}>
      <span>{options.find(option => option.value === value)?.label || options[0]?.label}</span>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {expanded && <div id={`${id}-options`} role="listbox" aria-label={label}
      className={`publishing-select-menu${placement.above ? " opens-above" : ""}`} style={{ maxHeight: placement.height }}>
      {options.map((option, index) => <button key={option.value} ref={element => { optionRefs.current[index] = element; }}
        type="button" role="option" aria-selected={option.value === value} tabIndex={-1}
        onClick={() => choose(option.value)} onKeyDown={event => {
          let next = -1;
          if (event.key === "ArrowDown") next = (index + 1) % options.length;
          else if (event.key === "ArrowUp") next = (index - 1 + options.length) % options.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = options.length - 1;
          else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
            for (let offset = 1; offset <= options.length; offset++) {
              const candidate = (index + offset) % options.length;
              if (options[candidate].label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase())) { next = candidate; break; }
            }
          }
          if (next >= 0) {
            event.preventDefault(); optionRefs.current[next]?.focus({ preventScroll: true }); optionRefs.current[next]?.scrollIntoView?.({ block: "nearest" });
          }
        }}>
        <span>{option.label}</span><span aria-hidden="true" className="publishing-select-check">{option.value === value ? "✓" : ""}</span>
      </button>)}
    </div>}
  </div>;
}
