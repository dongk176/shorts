"use client";

import { useEffect, useId, useRef, useState } from "react";

type Option = { value: string; label: string };

export function RankingSelect({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function show() {
    if (disabled) return;
    const rect = trigger.current?.getBoundingClientRect();
    setAbove(
      Boolean(
        rect &&
          window.innerHeight - rect.bottom <
            Math.min(280, options.length * 44 + 12) &&
          rect.top > 280,
      ),
    );
    setOpen(true);
    requestAnimationFrame(() =>
      items.current[
        Math.max(
          0,
          options.findIndex((option) => option.value === value),
        )
      ]?.focus(),
    );
  }
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div
      ref={root}
      className="ranking-select"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        className="ranking-select-trigger"
        onClick={() => {
          if (open) close();
          else show();
        }}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            show();
          }
        }}
      >
        <span>{options.find((option) => option.value === value)?.label}</span>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path
            d="m5 7 5 5 5-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </svg>
      </button>
      {open && !disabled ? (
        <div
          id={id}
          role="listbox"
          aria-label={label}
          className={`ranking-select-menu ${above ? "is-above" : ""}`}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              ref={(element) => {
                items.current[index] = element;
              }}
              type="button"
              role="option"
              aria-selected={option.value === value}
              tabIndex={-1}
              onClick={() => {
                onChange(option.value);
                close();
              }}
              onKeyDown={(event) => {
                const direction =
                  event.key === "ArrowDown"
                    ? 1
                    : event.key === "ArrowUp"
                      ? -1
                      : 0;
                if (direction || event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? options.length - 1
                        : (index + direction + options.length) % options.length;
                  items.current[next]?.focus();
                }
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? (
                <span aria-hidden="true">✓</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
