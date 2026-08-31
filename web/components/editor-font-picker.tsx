"use client";

import { useEffect, useId, useRef, useState } from "react";
import { editorFontOptions, stableEditorFontOptions, type EditorFontId } from "@/lib/editor-fonts";

/** Shared by the existing video editor and the template's extra text controls. */
export function EditorFontPicker({
  value,
  onChange,
  options = stableEditorFontOptions,
}: {
  value: EditorFontId;
  onChange: (fontId: EditorFontId) => void;
  options?: readonly (typeof editorFontOptions)[number][];
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((font) => font.id === value)));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pickerId = useId();
  const labelId = `${pickerId}-label`;
  const listboxId = `${pickerId}-listbox`;
  const selectedFont = options.find((font) => font.id === value) || options[0] || editorFontOptions[0];

  const closePicker = (restoreTriggerFocus = false) => {
    setOpen(false);
    if (restoreTriggerFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const focusOption = (index: number) => {
    if (options.length === 0) return;
    const nextIndex = (index + options.length) % options.length;
    setActiveIndex(nextIndex);
    window.requestAnimationFrame(() => optionRefs.current[nextIndex]?.focus());
  };
  const openPicker = (index = options.findIndex((font) => font.id === value)) => {
    if (options.length === 0) return;
    setOpen(true);
    focusOption(index);
  };

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  return <div className="editor-font-setting">
    <span id={labelId}>폰트</span>
    <div
      ref={rootRef}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setOpen(false);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && open) {
          event.preventDefault();
          closePicker(true);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="editor-font-picker-trigger"
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        onClick={() => open ? closePicker() : openPicker()}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          openPicker(options.findIndex((font) => font.id === value) + (event.key === "ArrowDown" ? 1 : -1));
        }}
        style={{ fontFamily: selectedFont.family }}
      >
        <span>{selectedFont.label}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && <div id={listboxId} role="listbox" aria-labelledby={labelId} className="editor-font-picker-menu">
        {options.map((font, index) => <button
          key={font.id}
          ref={(element) => { optionRefs.current[index] = element; }}
          type="button"
          role="option"
          aria-selected={font.id === value}
          tabIndex={index === activeIndex ? 0 : -1}
          onClick={() => { onChange(font.id); closePicker(true); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              focusOption(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              focusOption(event.key === "Home" ? 0 : options.length - 1);
            }
          }}
          style={{ fontFamily: font.family }}
        >
          <span>{font.label}</span>
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="m5 10 3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>)}
      </div>}
    </div>
  </div>;
}
