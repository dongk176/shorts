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
    <div className={`rounded-2xl border border-white/10 bg-white/[.025] p-4 ${className}`}>
      <p className="mb-3 rounded-xl border border-amber-300/15 bg-amber-300/[.06] px-3 py-2 text-xs font-bold leading-5 text-amber-100">
        3분 이상 60분 이하의 롱폼 원본 영상만 지원합니다. 유료 작업 제출·전자책 다운로드·유료 인기 필터 결과 열람 시 디지털 서비스 제공이 시작되고 이용 기록이 저장되어 청약철회·환불 판단에 사용될 수 있습니다.
      </p>
      <div className="flex items-start gap-3">
        <input
          id={consentId}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-[#ff715e]"
          aria-label="[필수] 지원 영상 조건, 디지털 서비스 제공 개시, 구매약관 및 취소·환불 규정 동의"
        />
        <p className="min-w-0 text-xs font-medium leading-6 text-neutral-300">
          <label htmlFor={consentId} className="cursor-pointer">
            <strong className="text-[#ff9b8d]">[필수]</strong> 위 지원 영상 조건과 디지털 서비스 제공 개시 안내,{" "}
          </label>
          <Link
            href="/purchase-terms"
            target="_blank"
            rel="noopener noreferrer"
            className="font-black text-[#ff9b8d] underline decoration-[#ff9b8d]/45 underline-offset-2"
          >
            구매약관
          </Link>
          <label htmlFor={consentId} className="cursor-pointer">
            {" "}및{" "}
          </label>
          <Link
            href="/refund"
            target="_blank"
            rel="noopener noreferrer"
            className="font-black text-[#ff9b8d] underline decoration-[#ff9b8d]/45 underline-offset-2"
          >
            취소·환불 규정
          </Link>
          <label htmlFor={consentId} className="cursor-pointer">
            을 확인했으며 이에 동의합니다.
          </label>
        </p>
      </div>
    </div>
  );
}
