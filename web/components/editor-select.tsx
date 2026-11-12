"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./editor-select.module.css";

export function EditorSelect<T extends string>({ label, value, options, onChange, disabled = false }: {
  label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 240 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const expanded = open && !disabled;
  useEffect(() => {
    if (!expanded) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const height = Math.min(260, options.length * 40 + 10);
      const above = innerHeight - rect.bottom < height + 12 && rect.top > height + 12;
      setPosition({ top: above ? rect.top - height - 6 : rect.bottom + 6, left: Math.max(8, Math.min(rect.left, innerWidth - rect.width - 8)), width: rect.width, maxHeight: above ? Math.min(height, rect.top - 12) : Math.min(height, innerHeight - rect.bottom - 14) });
    };
    const outside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false); };
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) place(); };
    place(); items.current[index]?.focus({ preventScroll: true });
    document.addEventListener("pointerdown", outside); document.addEventListener("scroll", scroll, true); window.addEventListener("resize", place);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", place); };
  }, [expanded, index, options.length]);
  const choose = (next: T) => { onChange(next); setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  return <>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-expanded={expanded} aria-haspopup="listbox" aria-controls={expanded ? id : undefined} className={styles.trigger} disabled={disabled}
      onClick={() => { setIndex(Math.max(0, options.findIndex(option => option.value === value))); setOpen(!open); }}
      onKeyDown={event => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setIndex(Math.max(0, options.findIndex(option => option.value === value))); setOpen(true); } }}>
      <span>{options.find(option => option.value === value)?.label || options[0]?.label}</span><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {expanded ? createPortal(<div ref={menu} id={id} role="listbox" aria-label={label} className={styles.menu} style={position} onKeyDown={event => {
      if (event.key === "Escape" || event.key === "Tab") { if (event.key === "Escape") event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus({ preventScroll: true }); }
      const next = event.key === "ArrowDown" ? (index + 1) % options.length : event.key === "ArrowUp" ? (index - 1 + options.length) % options.length : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : null;
      if (next !== null) { event.preventDefault(); event.stopPropagation(); setIndex(next); items.current[next]?.scrollIntoView({ block: "nearest" }); }
    }}>{options.map((option, itemIndex) => <button ref={element => { items.current[itemIndex] = element; }} key={option.value} type="button" role="option" aria-selected={option.value === value} tabIndex={-1} onClick={() => choose(option.value)}><span>{option.label}</span><span aria-hidden="true">{option.value === value ? "✓" : ""}</span></button>)}</div>, document.body) : null}
  </>;
}
