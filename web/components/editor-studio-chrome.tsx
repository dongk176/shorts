"use client";
import type { ReactNode, MouseEventHandler, PointerEventHandler } from "react";
import { useUiText } from "@/lib/i18n/use-ui-text";

export function EditorStudioTopbar({ children }: { children: ReactNode }) {
  return <header className="editor-topbar"><div className="editor-topbar-inner">{children}</div></header>;
}
export function EditorStudioBackButton({ onClick, onPointerDown }: {
  onClick: MouseEventHandler<HTMLButtonElement>;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
}) {
  const ui = useUiText();
  return <button type="button" className="editor-studio-back" aria-label={ui("프로젝트로 돌아가기")}
    onClick={onClick} onPointerDown={onPointerDown}>
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m11.5 5-5 5 5 5M7 10h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    <span>Easy<span className="editor-studio-brand-accent">Cut</span></span>
  </button>;
}

export function EditorViewportZoomControl({
  label,
  value,
  min,
  max,
  step,
  className,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  className: string;
  onChange: (value: number) => void;
}) {
  const ui = useUiText();
  const update = (direction: -1 | 1) => {
    const next = Math.min(max, Math.max(min, value + direction * step));
    onChange(Math.round(next * 100) / 100);
  };
  return <div
    className={`editor-viewport-zoom-control ${className}`}
    aria-label={ui(`${label} 확대`)}
    onPointerDown={(event) => event.stopPropagation()}
  >
    <span>{ui(label)}</span>
    <button
      type="button"
      aria-label={ui(`${label} 축소`)}
      disabled={value <= min}
      onClick={() => update(-1)}
    >
      −
    </button>
    <output aria-label={ui(`${label} 확대 비율`)}>
      {Math.round(value * 100)}%
    </output>
    <button
      type="button"
      aria-label={ui(`${label} 확대`)}
      disabled={value >= max}
      onClick={() => update(1)}
    >
      +
    </button>
  </div>;
}
