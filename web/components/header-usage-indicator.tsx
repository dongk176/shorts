"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useUsageState } from "@/components/usage-provider";
import { useI18n } from "@/lib/i18n/provider";

function wholeMinutes(seconds: number) {
  return Math.max(0, Math.floor(seconds / 60));
}

export function HeaderUsageIndicator() {
  const usageState = useUsageState();
  const { t } = useI18n();
  const targetMinutes = usageState.usage
    ? wholeMinutes(usageState.usage.remainingSeconds)
    : 0;
  const [displayedMinutes, setDisplayedMinutes] = useState(targetMinutes);
  const displayedMinutesRef = useRef(targetMinutes);

  useEffect(() => {
    const startMinutes = displayedMinutesRef.current;
    if (
      targetMinutes <= startMinutes
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      displayedMinutesRef.current = targetMinutes;
      setDisplayedMinutes(targetMinutes);
      return;
    }

    const difference = targetMinutes - startMinutes;
    const duration = Math.min(1_400, Math.max(700, difference * 3));
    let animationFrame = 0;
    let startedAt: number | null = null;
    const animate = (timestamp: number) => {
      startedAt ??= timestamp;
      const progress = Math.min(1, (timestamp - startedAt) / duration);
      const easedProgress = 1 - ((1 - progress) ** 3);
      const nextMinutes = Math.min(
        targetMinutes,
        startMinutes + Math.max(1, Math.floor(difference * easedProgress)),
      );
      displayedMinutesRef.current = nextMinutes;
      setDisplayedMinutes(nextMinutes);
      if (progress < 1) animationFrame = window.requestAnimationFrame(animate);
    };
    animationFrame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [targetMinutes]);

  if (!usageState.authenticated || !usageState.usage) return null;
  const label = t("common.remainingMinutes", { minutes: displayedMinutes });

  return (
    <Link
      href="/pricing"
      aria-label={label}
      title={label}
      className="header-usage-indicator inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[.035] px-2.5 text-xs font-extrabold tabular-nums text-neutral-200 transition hover:border-[#ff8c7c]/45 hover:bg-[#ff8c7c]/10 hover:text-white"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 text-[#ff9b8d]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </svg>
      <span className="hidden whitespace-nowrap lg:inline">{label}</span>
    </Link>
  );
}
