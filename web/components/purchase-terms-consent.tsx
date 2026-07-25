"use client";

import Link from "next/link";
import { useId } from "react";

export function PurchaseTermsConsent({
  checked,
  onChange,
  className = "",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  const consentId = useId();
  return (
    <div className={`flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[.025] p-4 ${className}`}>
      <input
        id={consentId}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-[#ff715e]"
        aria-label="[필수] 구매약관 및 취소·환불 규정 동의"
      />
      <p className="min-w-0 text-xs font-medium leading-6 text-neutral-300">
        <label htmlFor={consentId} className="cursor-pointer">
          <strong className="text-[#ff9b8d]">[필수]</strong>{" "}
          구매약관 및 취소·환불 규정을 확인했으며 이에 동의합니다.{" "}
        </label>
        <Link
          href="/purchase-terms"
          target="_blank"
          rel="noopener noreferrer"
          className="font-black text-[#ff9b8d] underline decoration-[#ff9b8d]/45 underline-offset-2"
        >
          구매약관 보기 ↗
        </Link>
        <span className="text-neutral-600"> · </span>
        <Link
          href="/refund"
          target="_blank"
          rel="noopener noreferrer"
          className="font-black text-[#ff9b8d] underline decoration-[#ff9b8d]/45 underline-offset-2"
        >
          취소·환불 규정 보기 ↗
        </Link>
      </p>
    </div>
  );
}
