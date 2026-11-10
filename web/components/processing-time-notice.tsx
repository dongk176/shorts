"use client";

import Link from "@/lib/i18n/navigation";
import { useUsageState } from "@/components/usage-provider";
import { useI18n } from "@/lib/i18n/provider";
import { MIN_SELECTED_SOURCE_SECONDS } from "@/lib/source-range";
import { conversionCopy } from "@/lib/conversion-copy";
import { trackConversion } from "@/lib/conversion-events-client";

export function ProcessingTimeNotice() {
  const { authenticated, isEnterprise, usage } = useUsageState();
  const { locale } = useI18n();
  if (!authenticated || isEnterprise || !usage?.enforcementEnabled
    || usage.remainingSeconds >= MIN_SELECTED_SOURCE_SECONDS) return null;
  const copy = conversionCopy[locale];
  return (
    <aside className="mx-auto flex w-full max-w-4xl flex-col gap-3 rounded-2xl border border-[#ff8c7c]/30 bg-[#ff8c7c]/[.07] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-bold leading-snug text-white sm:text-base">{usage.remainingSeconds <= 0 ? copy.exhausted : copy.low}</p>
        <p className="mt-1 text-sm leading-snug text-neutral-300">{copy.detail}</p>
      </div>
      <Link href="/pricing" onClick={() => trackConversion({ name: "upgrade_clicked", locale, surface: "credit_notice" })}
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-[#ff8c7c] px-4 py-2 text-sm font-bold text-black transition hover:bg-[#ffa596]">
        {copy.plans}
      </Link>
    </aside>
  );
}
