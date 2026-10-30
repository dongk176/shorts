"use client";
import { useUiText } from "@/lib/i18n/use-ui-text";

import { useEffect, useId, useRef, useState } from "react";

const colors = [
  ["화이트", "#FFFFFF"],
  ["블랙", "#111111"],
  ["댓글 블루", "#35E6E3"],
  ["블루", "#3B82F6"],
  ["레드", "#FF4D4F"],
  ["옐로", "#FFD84D"],
  ["라임", "#8BFF5A"],
  ["오렌지", "#FF8A3D"],
  ["핑크", "#FF65B3"],
  ["퍼플", "#A78BFA"],
];
export function RankingColorField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const ui = useUiText();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  function swatch(name: string, color: string) {
    return (
      <button
        key={color}
        type="button"
        aria-label={`${label} ${name}`}
        aria-pressed={color.toLowerCase() === value.toLowerCase()}
        title={name}
        style={{ backgroundColor: color }}
        onClick={() => onChange(color)}
      />
    );
  }
  return (
    <div
      ref={root}
      className="ranking-color-field"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          setOpen(false);
          more.current?.focus();
        }
      }}
    >
      <span className="ranking-field-label">{label}</span>
      <div className="ranking-color-swatches">
        {swatch(ui("현재 색상"), value)}
        {colors
          .filter(([, color]) => color.toLowerCase() !== value.toLowerCase())
          .slice(0, 2)
          .map(([name, color]) => swatch(name, color))}
        <button
          ref={more}
          type="button"
          className="ranking-color-more"
          aria-label={ui(`${label} 더 보기`)}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {open ? "−" : "+"}
        </button>
      </div>
      {open && !disabled ? (
        <div
          id={id}
          className="ranking-color-popover"
          role="group"
          aria-label={ui(`${label} 선택`)}
        >
          <div className="ranking-color-swatches">
            {colors.map(([name, color]) => swatch(name, color))}
          </div>
          <div className="ranking-color-custom">
            <label>
              {ui("직접 선택")}<input
                type="color"
                aria-label={ui(`${label} 직접 선택`)}
                value={value}
                onChange={(event) => onChange(event.target.value)}
              />
            </label>
            <input
              key={value}
              aria-label={`${label} HEX`}
              defaultValue={value.toUpperCase()}
              maxLength={7}
              onChange={(event) => {
                if (/^#[0-9a-fA-F]{6}$/.test(event.target.value))
                  onChange(event.target.value);
              }}
              onBlur={(event) => {
                event.target.value = value.toUpperCase();
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
