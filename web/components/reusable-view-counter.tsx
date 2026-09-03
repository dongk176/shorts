"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
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

function generatedShortsLabel(locale: SiteLocale) {
  if (locale === "en") return "Shorts created so far";
  if (locale === "ja") return "これまでに作成したショート動画";
  return "지금까지 생성된 쇼츠";
}

function metricDescription(showingViews: boolean, locale: SiteLocale) {
  if (locale === "en") {
    return showingViews
      ? "Total views of reuse-allowed videos."
      : "Shorts completed with EasyCut.";
  }
  if (locale === "ja") {
    return showingViews
      ? "再利用可能な動画の累計再生回数です。"
      : "EasyCutで完成したショート動画の数です。";
  }
  return showingViews
    ? "재사용 허용 영상의 누적 조회수예요."
    : "이지컷에서 생성 완료된 쇼츠 수예요.";
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
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
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
    if (!helpOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setHelpOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHelpOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [helpOpen]);

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
  const currentLabel = showingViews
    ? counterLabel(locale)
    : generatedShortsLabel(locale);
  return (
    <div ref={containerRef} className={`home-generated-shorts-count ${className}`}>
      <button
        type="button"
        className="home-metric-toggle"
        aria-label={accessibleLabel(
          showingViews,
          viewValue,
          generatedValue,
          locale,
        )}
        onClick={() => {
          setShowingViews((current) => !current);
          setHelpOpen(false);
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
      <span className="home-metric-help-positioner">
        <span className="home-metric-number-measure" aria-hidden="true">
          {showingViews ? viewValue : generatedValue}
        </span>
        <button
          type="button"
          className="home-metric-help"
          aria-label={`${currentLabel} 설명`}
          aria-expanded={helpOpen}
          aria-controls={helpId}
          onClick={() => setHelpOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setHelpOpen(false);
          }}
        >
          ?
        </button>
      </span>
      {helpOpen ? (
        <span id={helpId} role="tooltip" className="home-metric-description">
          {metricDescription(showingViews, locale)}
        </span>
      ) : null}
    </div>
  );
}
