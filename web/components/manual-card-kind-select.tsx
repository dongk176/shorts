"use client";

import { useRef } from "react";

export type ManualCardKind = "credit" | "debit_prepaid";

const options: Array<{
  value: ManualCardKind;
  label: string;
  description: string;
}> = [
  {
    value: "credit",
    label: "신용카드",
    description: "할부 선택 가능",
  },
  {
    value: "debit_prepaid",
    label: "체크·선불카드",
    description: "일시불 결제",
  },
];

export function ManualCardKindSelect({
  value,
  onChange,
  attention = false,
  disabled = false,
}: {
  value: ManualCardKind | "";
  onChange: (value: ManualCardKind) => void;
  attention?: boolean;
  disabled?: boolean;
}) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  return (
    <div
      role="radiogroup"
      aria-label="카드 종류"
      aria-required="true"
      data-card-kind-select
      className={`grid grid-cols-2 gap-2 rounded-2xl border p-1.5 transition ${
        attention
          ? "animate-[pulse_1.2s_ease-in-out_2] border-[#ff8f7f]/80 shadow-[0_0_0_3px_rgba(255,113,94,.13),0_0_24px_rgba(255,113,94,.16)]"
          : "border-white/[.08]"
      }`}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const currentIndex = options.findIndex((option) => option.value === value);
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const nextIndex = currentIndex === -1
          ? direction === 1 ? 0 : options.length - 1
          : (currentIndex + direction + options.length) % options.length;
        const nextOption = options[nextIndex];
        onChange(nextOption.value);
        optionRefs.current[nextIndex]?.focus();
      }}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => { optionRefs.current[index] = element; }}
            type="button"
            role="radio"
            aria-checked={selected}
            data-card-kind-option={option.value}
            data-payment-autofocus={index === 0 ? "" : undefined}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`min-h-[68px] rounded-xl border px-3 py-2.5 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[#ff8f80]/65 ${
              selected
                ? "border-[#ff8f7f]/55 bg-[#ff715e]/12 text-white"
                : "border-transparent bg-white/[.025] text-neutral-300 hover:bg-white/[.055] hover:text-white"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <strong className="block text-base">{option.label}</strong>
            <span className={`mt-1 block text-sm ${
              selected ? "text-[#ffb1a5]" : "text-neutral-500"
            }`}>
              {option.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
