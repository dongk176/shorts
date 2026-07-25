"use client";

import Link from "next/link";

export function PurchaseTermsConsent({
  checked,
  onChange,
  className = "",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-white/8 bg-black/15 p-4 ${className}`}>
      <label className="flex cursor-pointer items-start gap-3 text-xs leading-6 text-neutral-300">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-[#ff715e]"
        />
        <span>
          <strong className="text-white">[필수]</strong>{" "}
          구매약관 및 취소·환불 규정을 확인했으며 이에 동의합니다.
        </span>
      </label>
      <div className="ml-7 mt-3 flex flex-wrap gap-2">
        <Link
          href="/purchase-terms"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-9 items-center justify-center rounded-lg border border-white/12 bg-white/[.04] px-3 text-[11px] font-bold text-white transition hover:border-white/25 hover:bg-white/[.08]"
        >
          구매약관 보기 ↗
        </Link>
        <Link
          href="/refund"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-9 items-center justify-center rounded-lg border border-white/12 bg-white/[.04] px-3 text-[11px] font-bold text-white transition hover:border-white/25 hover:bg-white/[.08]"
        >
          취소·환불 규정 보기 ↗
        </Link>
      </div>
    </div>
  );
}
