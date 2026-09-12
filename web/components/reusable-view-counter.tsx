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
const METRIC_REFRESH_INTERVAL_MS = 60_000;

type PublicMetrics = {
  reusableViewCounter: ReusableViewCounterState | null;
  generatedShortCount: number | null;
};

function sameSchedule(left: ReusableViewCounterState | null, right: ReusableViewCounterState | null) {
  return left?.startValue === right?.startValue && left?.targetValue === right?.targetValue
    && left?.startedAt === right?.startedAt && left?.endsAt === right?.endsAt;
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
  counter: initialCounter,
  generatedShortCount: initialGeneratedShortCount,
  locale,
  className = "",
}: {
  counter: ReusableViewCounterState | null;
  generatedShortCount: number | null;
  locale: SiteLocale;
  className?: string;
}) {
  const [liveMetrics, setLiveMetrics] = useState<PublicMetrics | null>(null);
  const useLiveMetrics = Boolean(liveMetrics?.reusableViewCounter && (
    !initialCounter
    || Date.parse(liveMetrics.reusableViewCounter.startedAt) > Date.parse(initialCounter.startedAt)
    || (liveMetrics.reusableViewCounter.startedAt === initialCounter.startedAt
      && Date.parse(liveMetrics.reusableViewCounter.serverNow) >= Date.parse(initialCounter.serverNow))
  ));
  const counter = useLiveMetrics ? liveMetrics!.reusableViewCounter : initialCounter;
  const generatedShortCount = useLiveMetrics ? liveMetrics!.generatedShortCount : initialGeneratedShortCount;

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const refresh = async () => {
      clearTimer();
      if (stopped || document.hidden || controller) return;
      const request = new AbortController();
      controller = request;
      const deadline = window.setTimeout(() => request.abort(), 8_000);
      try {
        const response = await fetch("/api/site-metrics", { signal: request.signal, cache: "no-store" });
        if (!response.ok) return;
        const value = await response.json() as PublicMetrics;
        const next = value.reusableViewCounter;
        if (!next || !Number.isSafeInteger(next.startValue) || !Number.isSafeInteger(next.targetValue)
          || next.startValue < 0 || next.targetValue < next.startValue
          || !Number.isFinite(Date.parse(next.serverNow))
          || !Number.isFinite(Date.parse(next.startedAt)) || !Number.isFinite(Date.parse(next.endsAt))
          || Date.parse(next.endsAt) <= Date.parse(next.startedAt)
          || !Number.isSafeInteger(value.generatedShortCount) || value.generatedShortCount! < 0) return;
        if (!stopped && !request.signal.aborted) setLiveMetrics(previous =>
          previous && sameSchedule(previous.reusableViewCounter, next)
            && previous.generatedShortCount === value.generatedShortCount ? previous : value);
      } catch {
        // Keep animating the last verified schedule during network failures.
      } finally {
        window.clearTimeout(deadline);
        controller = null;
        if (!stopped && !document.hidden) timer = window.setTimeout(refresh, METRIC_REFRESH_INTERVAL_MS);
      }
    };
    const handleVisibility = () => {
      clearTimer();
      if (document.hidden) controller?.abort();
      else void refresh();
    };
    void refresh();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stopped = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const [showingViews, setShowingViews] = useState(true);
  const [rotationResetToken, setRotationResetToken] = useState(0);
  const startValue = counter?.startValue;
  const targetValue = counter?.targetValue;
  const startedAt = counter?.startedAt;
  const endsAt = counter?.endsAt;
  const schedule = useMemo(
    () => startValue !== undefined && targetValue !== undefined && startedAt && endsAt
      ? { startValue, targetValue, startedAt, endsAt } : null,
    [startValue, targetValue, startedAt, endsAt],
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
  const clockOffsetRef = useRef(0);
  const serverNow = counter?.serverNow;
  useEffect(() => {
    const time = Date.parse(serverNow ?? "");
    if (Number.isFinite(time)) clockOffsetRef.current = time - Date.now();
  }, [serverNow]);

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
    if (!schedule) {
      displayedValueRef.current = null;
      setDisplayedValue(null);
      return;
    }
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
      const now = Date.now() + clockOffsetRef.current;
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
      } else update(true);
    };

    update(true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stopTimer();
      stopAnimation();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [changeTimes, schedule]);

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
