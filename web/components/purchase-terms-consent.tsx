"use client";

import Link from "@/lib/i18n/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { useId } from "react";

export function PurchaseTermsConsent({
  checked,
  onChange,
  className = "",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  packageTerms?: {
    months: number;
    monthlyPriceKrw: number;
  };
}) {
  const { t } = useI18n();
  const consentId = useId();
  return (
    <div
      className={`flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-white/[.025] p-4 transition hover:border-white/15 hover:bg-white/[.04] ${className}`}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("a, input")) return;
        onChange(!checked);
      }}
    >
      <input
        id={consentId}
        type="checkbox"
        required
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-[#ff715e]"
        aria-label={t("consent.aria")}
      />
      <p className="min-w-0 text-xs font-medium leading-6 text-neutral-300">
        <span>
          <strong className="text-[#ff9b8d]">{t("consent.required")}</strong>{" "}
        </span>
        {t("consent.prefix")}
        <Link
          href="/purchase-terms"
          target="_blank"
          rel="noopener noreferrer"
          className="font-black text-[#ff9b8d] underline decoration-[#ff9b8d]/45 underline-offset-2"
        >
          {t("consent.purchaseTerms")}
        </Link>
        <span>
          {t("consent.and")}
        </span>
        <span className="font-black text-neutral-200">{t("consent.refundRules")}</span>
        <span>
          {t("consent.suffix")}
        </span>
      </p>
    </div>
  );
}
