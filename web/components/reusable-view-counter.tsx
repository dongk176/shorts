"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SiteLocale } from "@/lib/i18n/config";
import {
  interpolateReusableViewCounterValue,
  projectReusableViewCounter,
  reusableViewCounterChangeTimes,
  type ReusableViewCounterState,
} from "@/lib/reusable-view-counter";

const COUNTER_ANIMATION_DURATION_MS = 1_800;

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
  const displayedValueRef = useRef<number | null>(initialValue);

  useEffect(() => {
    if (!counter || !schedule) {
      displayedValueRef.current = null;
      setDisplayedValue(null);
      return;
    }
    const serverNowMs = Date.parse(counter.serverNow);
    const clockOffsetMs = Number.isFinite(serverNowMs)
      ? serverNowMs - Date.now()
      : 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timeout: number | undefined;
    let animationFrame: number | undefined;

    const stopTimer = () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      timeout = undefined;
    };
    const stopAnimation = () => {
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
      animationFrame = undefined;
    };
    const showValue = (value: number) => {
      displayedValueRef.current = value;
      setDisplayedValue(value);
    };
    const animateTo = (targetValue: number) => {
      stopAnimation();
      const startValue = displayedValueRef.current ?? targetValue;
      if (targetValue <= startValue) {
        showValue(targetValue);
        return;
      }
      const animationStartedAt = window.performance.now();
      const animate = (now: number) => {
        if (document.hidden) return;
        const progress = Math.min(
          1,
          (now - animationStartedAt) / COUNTER_ANIMATION_DURATION_MS,
        );
        showValue(interpolateReusableViewCounterValue(
          startValue,
          targetValue,
          progress,
        ));
        if (progress < 1) animationFrame = window.requestAnimationFrame(animate);
        else animationFrame = undefined;
      };
      animationFrame = window.requestAnimationFrame(animate);
    };
    const update = (animateChange: boolean) => {
      stopTimer();
      if (document.hidden) return;
      const now = Date.now() + clockOffsetMs;
      const projection = projectReusableViewCounter(schedule, now, changeTimes);
      if (animateChange && !reducedMotion) animateTo(projection.value);
      else {
        stopAnimation();
        showValue(projection.value);
      }
      if (projection.nextChangeAtMs !== null) {
        timeout = window.setTimeout(
          () => update(true),
          Math.max(50, projection.nextChangeAtMs - now),
        );
      }
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopTimer();
        stopAnimation();
      } else update(false);
    };

    update(false);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stopTimer();
      stopAnimation();
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
