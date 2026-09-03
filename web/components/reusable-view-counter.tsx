"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SiteLocale } from "@/lib/i18n/config";
import {
  interpolateReusableViewCounterValue,
  projectReusableViewCounter,
  reusableViewCounterChangeTimes,
  type ReusableViewCounterState,
} from "@/lib/reusable-view-counter";

const COUNTER_ANIMATION_DURATION_MS = 1_800;
const METRIC_ROTATION_INTERVAL_MS = 7_000;

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

function generatedShortsLabel(locale: SiteLocale) {
  if (locale === "en") return "Shorts created so far";
  if (locale === "ja") return "これまでに作成したショート動画";
  return "지금까지 생성된 쇼츠";
}

function accessibleLabel(
  showingViews: boolean,
  viewValue: string,
  generatedValue: string,
  locale: SiteLocale,
) {
  if (locale === "en") {
    return showingViews
      ? `Cumulative views of reuse-allowed videos: ${viewValue}. Show shorts created so far`
      : `Shorts created so far: ${generatedValue}. Show cumulative views`;
  }
  if (locale === "ja") {
    return showingViews
      ? `再利用可能な動画の累計再生回数 ${viewValue}。これまでに作成したショート動画を表示`
      : `これまでに作成したショート動画 ${generatedValue}。累計再生回数を表示`;
  }
  return showingViews
    ? `재사용 허용 영상 누적 조회수 ${viewValue}. 지금까지 생성된 쇼츠 보기`
    : `지금까지 생성된 쇼츠 ${generatedValue}. 누적 조회수 보기`;
}

export function ReusableViewCounter({
  counter,
  generatedShortCount,
  locale,
  className = "",
}: {
  counter: ReusableViewCounterState | null;
  generatedShortCount: number | null;
  locale: SiteLocale;
  className?: string;
}) {
  const [showingViews, setShowingViews] = useState(true);
  const [rotationResetToken, setRotationResetToken] = useState(0);
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
    let timeout: number | undefined;
    const stopTimer = () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      timeout = undefined;
    };
    const scheduleSwitch = () => {
      stopTimer();
      if (document.hidden) return;
      timeout = window.setTimeout(() => {
        setShowingViews((current) => !current);
        scheduleSwitch();
      }, METRIC_ROTATION_INTERVAL_MS);
    };
    const handleVisibilityChange = () => scheduleSwitch();

    scheduleSwitch();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stopTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [rotationResetToken]);

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

  const viewValue = visibleValue(displayedValue, locale);
  const generatedValue = generatedShortCount === null
    ? "—"
    : generatedShortCount.toLocaleString(numberLocale(locale));
  return (
    <button
      type="button"
      className={`home-generated-shorts-count ${className}`}
      aria-label={accessibleLabel(
        showingViews,
        viewValue,
        generatedValue,
        locale,
      )}
      onClick={() => {
        setShowingViews((current) => !current);
        setRotationResetToken((current) => current + 1);
      }}
    >
      <span className="home-metric-stage" aria-hidden="true">
        <span
          className={`home-metric-panel ${showingViews ? "is-active" : ""}`}
          data-metric="views"
        >
          <strong aria-busy={counter === null}>{viewValue}</strong>
          <span className="home-metric-label">{counterLabel(locale)}</span>
        </span>
        <span
          className={`home-metric-panel ${showingViews ? "" : "is-active"}`}
          data-metric="generated-shorts"
        >
          <strong aria-busy={generatedShortCount === null}>{generatedValue}</strong>
          <span className="home-metric-label">{generatedShortsLabel(locale)}</span>
        </span>
      </span>
    </button>
  );
}
