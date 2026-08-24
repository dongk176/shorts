"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FeatureGuideOverlay } from "@/components/feature-guide-overlay";
import {
  SOURCE_RANGE_GUIDE_STORAGE_KEY,
  sourceRangeGuideSteps,
} from "@/lib/source-range-guide";

const SCROLL_SETTLE_MS = 160;
const NO_SCROLL_SETTLE_MS = 260;
const SCROLL_MAX_WAIT_MS = 1_800;
const INITIAL_SCROLL_GRACE_MS = 220;

export function SourceRangeGuide({
  enabled,
  onComplete,
}: {
  enabled: boolean;
  onComplete?: () => void;
}) {
  const [guideReady, setGuideReady] = useState(false);
  const completionReportedRef = useRef(false);
  const reportComplete = useCallback(() => {
    if (completionReportedRef.current) return;
    completionReportedRef.current = true;
    onComplete?.();
  }, [onComplete]);

  useEffect(() => {
    setGuideReady(false);
    if (!enabled) {
      completionReportedRef.current = false;
      return;
    }

    try {
      if (window.localStorage.getItem(SOURCE_RANGE_GUIDE_STORAGE_KEY) === "1") {
        reportComplete();
        return;
      }
    } catch {
      // Local storage is optional. The guide can still run for this visit.
    }

    let cancelled = false;
    let seekFrame = 0;
    let settleTimer = 0;
    let noScrollTimer = 0;
    let maxWaitTimer = 0;
    let existingScrollTimer = 0;
    let existingScrollMaxWaitTimer = 0;
    let sawScroll = false;

    function cleanupScrollTracking() {
      window.clearTimeout(settleTimer);
      window.clearTimeout(noScrollTimer);
      window.clearTimeout(maxWaitTimer);
      window.clearTimeout(existingScrollTimer);
      window.clearTimeout(existingScrollMaxWaitTimer);
      window.removeEventListener("scroll", handleExistingScroll, true);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("scrollend", handleScrollEnd);
    }

    function finish() {
      if (cancelled) return;
      cleanupScrollTracking();
      window.requestAnimationFrame(() => {
        if (!cancelled) setGuideReady(true);
      });
    }

    function handleScrollEnd() {
      if (sawScroll) finish();
    }

    function handleScroll() {
      sawScroll = true;
      window.clearTimeout(noScrollTimer);
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(finish, SCROLL_SETTLE_MS);
    }

    function scrollToFirstTarget(remainingAttempts: number) {
      const selector = sourceRangeGuideSteps[0]?.targetSelector;
      const target = selector ? document.querySelector(selector) : null;
      if (!target && remainingAttempts > 0) {
        seekFrame = window.requestAnimationFrame(() => scrollToFirstTarget(remainingAttempts - 1));
        return;
      }
      if (!target) {
        finish();
        return;
      }

      window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
      window.addEventListener("scrollend", handleScrollEnd, { passive: true });
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      noScrollTimer = window.setTimeout(finish, NO_SCROLL_SETTLE_MS);
      maxWaitTimer = window.setTimeout(finish, SCROLL_MAX_WAIT_MS);
    }

    function beginTargetScroll() {
      window.clearTimeout(existingScrollTimer);
      window.clearTimeout(existingScrollMaxWaitTimer);
      window.removeEventListener("scroll", handleExistingScroll, true);
      seekFrame = window.requestAnimationFrame(() => scrollToFirstTarget(12));
    }

    function handleExistingScroll() {
      window.clearTimeout(existingScrollTimer);
      existingScrollTimer = window.setTimeout(beginTargetScroll, SCROLL_SETTLE_MS);
    }

    window.addEventListener("scroll", handleExistingScroll, { capture: true, passive: true });
    existingScrollTimer = window.setTimeout(beginTargetScroll, INITIAL_SCROLL_GRACE_MS);
    existingScrollMaxWaitTimer = window.setTimeout(beginTargetScroll, SCROLL_MAX_WAIT_MS);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(seekFrame);
      cleanupScrollTracking();
    };
  }, [enabled, reportComplete]);

  return (
    <FeatureGuideOverlay
      enabled={enabled && guideReady}
      steps={sourceRangeGuideSteps}
      storageKey={SOURCE_RANGE_GUIDE_STORAGE_KEY}
      closeAriaLabel="구간 선택 가이드 닫기"
      smoothTransitions
      onClose={reportComplete}
    />
  );
}
