"use client";

import {
  formatStoredCardLabel,
  resolveStoredCardIssuer,
} from "@/lib/billing-card";

export type SelectedPaymentCardInfo = {
  issuer: string | null;
  last4: string | null;
};

export function SelectedPaymentCard({
  card,
  disabled = false,
  onUseDifferentCard,
}: {
  card: SelectedPaymentCardInfo;
  disabled?: boolean;
  onUseDifferentCard: () => void;
}) {
  const maskedNumber = formatStoredCardLabel({ last4: card.last4 }) || "등록 카드";
  const issuer = resolveStoredCardIssuer({ issuer: card.issuer });

  return (
    <section
      className="rounded-2xl border border-[#ff8f80]/20 bg-[#ff715e]/[.055] p-4"
      aria-label="선택된 카드"
    >
      <p className="text-[11px] font-black tracking-[.08em] text-[#ff9b8d]">
        선택된 카드
      </p>
      <div className="mt-3 flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid h-11 w-14 shrink-0 place-items-center rounded-xl border border-white/10 bg-[#101315] text-lg text-neutral-300"
        >
          ▰
        </span>
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-sm font-black text-white">
            {issuer || "등록 카드"}
          </strong>
          <span className="mt-0.5 block text-sm font-bold tracking-[.08em] text-neutral-400">
            {maskedNumber}
          </span>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={onUseDifferentCard}
          className="min-h-10 shrink-0 rounded-xl border border-white/10 px-3 text-xs font-black text-neutral-200 transition hover:border-[#ff8f80]/45 hover:bg-white/[.05] hover:text-white disabled:opacity-40"
        >
          다른 카드 사용
        </button>
      </div>
    </section>
  );
}
