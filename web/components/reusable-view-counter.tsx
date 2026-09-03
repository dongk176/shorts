"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { SiteLocale } from "@/lib/i18n/config";
import {
  projectReusableViewCounter,
  reusableViewCounterChangeTimes,
  type ReusableViewCounterState,
} from "@/lib/reusable-view-counter";

function scheduleFromState(counter: ReusableViewCounterState) {
  return {
    startValue: counter.startValue,
    targetValue: counter.targetValue,
    startedAt: counter.startedAt,
    endsAt: counter.endsAt,
  };
}

function numberLocale(locale: SiteLocale) {
  if (locale === "en") return "en-US";
  if (locale === "ja") return "ja-JP";
  return "ko-KR";
}

function visibleValue(value: number | null, locale: SiteLocale) {
  if (value === null) return "—";
  const formatted = value.toLocaleString(numberLocale(locale));
  if (locale === "ko") return `${formatted}회`;
  if (locale === "ja") return `${formatted}回`;
  return formatted;
}

function counterLabel(locale: SiteLocale) {
  if (locale === "en") return "Cumulative views";
  if (locale === "ja") return "累計再生回数";
  return "누적 조회수";
}

function accessibleLabel(value: string, locale: SiteLocale) {
  if (locale === "en") {
    return `Cumulative views of reuse-allowed videos: ${value}. View trending videos`;
  }
  if (locale === "ja") {
    return `再利用可能な動画の累計再生回数 ${value}。リアルタイム人気を見る`;
  }
  return `재사용 허용 영상 누적 조회수 ${value}. 실시간 인기 보기`;
}

export function ReusableViewCounter({
  counter,
  locale,
  className = "",
}: {
  counter: ReusableViewCounterState | null;
  locale: SiteLocale;
  className?: string;
}) {
  const schedule = useMemo(
    () => counter ? scheduleFromState(counter) : null,
    [counter],
  );
  const changeTimes = useMemo(
    () => schedule ? reusableViewCounterChangeTimes(schedule) : [],
    [schedule],
  );
  const initialValue = useMemo(() => {
    if (!counter || !schedule) return null;
    return projectReusableViewCounter(
      schedule,
      Date.parse(counter.serverNow),
      changeTimes,
    ).value;
  }, [changeTimes, counter, schedule]);
  const [displayedValue, setDisplayedValue] = useState<number | null>(initialValue);

  useEffect(() => {
    if (!counter || !schedule) {
      setDisplayedValue(null);
      return;
    }
    const serverNowMs = Date.parse(counter.serverNow);
    const clockOffsetMs = Number.isFinite(serverNowMs)
      ? serverNowMs - Date.now()
      : 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timeout: number | undefined;

    const stopTimer = () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      timeout = undefined;
    };
    const update = () => {
      stopTimer();
      if (document.hidden) return;
      if (reducedMotion) {
        setDisplayedValue(counter.targetValue);
        return;
      }
      const now = Date.now() + clockOffsetMs;
      const projection = projectReusableViewCounter(schedule, now, changeTimes);
      setDisplayedValue(projection.value);
      if (projection.nextChangeAtMs !== null) {
        timeout = window.setTimeout(
          update,
          Math.max(50, projection.nextChangeAtMs - now),
        );
      }
    };
    const handleVisibilityChange = () => {
      if (document.hidden) stopTimer();
      else update();
    };

    update();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stopTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [changeTimes, counter, schedule]);

  const value = visibleValue(displayedValue, locale);
  return (
    <Link
      href="/popular"
      className={`home-generated-shorts-count ${className}`}
      aria-label={accessibleLabel(value, locale)}
    >
      <strong aria-busy={counter === null}>{value}</strong>
      <p>{counterLabel(locale)}</p>
    </Link>
  );
}
