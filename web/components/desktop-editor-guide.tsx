"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  clampDesktopEditorGuideStepIndex,
  DESKTOP_EDITOR_GUIDE_MEDIA_QUERY,
  DESKTOP_EDITOR_GUIDE_STORAGE_KEY,
  desktopEditorGuideStepsFor,
  shouldShowDesktopEditorGuide,
} from "@/lib/desktop-editor-guide";

type TargetRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

const SPOTLIGHT_PADDING = 9;
const CARD_GAP = 18;
const ESTIMATED_CARD_HEIGHT = 290;

function elementRect(element: Element | null): TargetRect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

export function DesktopEditorGuide({
  enabled,
  rangeControlsAvailable,
  commentControlsAvailable,
}: {
  enabled: boolean;
  rangeControlsAvailable: boolean;
  commentControlsAvailable: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const sessionClosedRef = useRef(false);
  const cardRef = useRef<HTMLElement>(null);
  const guideSteps = useMemo(() => desktopEditorGuideStepsFor({
    rangeControlsAvailable,
    commentControlsAvailable,
  }), [commentControlsAvailable, rangeControlsAvailable]);
  const activeStepIndex = clampDesktopEditorGuideStepIndex(stepIndex, guideSteps.length);
  const step = guideSteps[activeStepIndex];
  const targetSelector = step?.targetSelector ?? null;
  const isLastStep = activeStepIndex === guideSteps.length - 1;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const desktopMedia = window.matchMedia(DESKTOP_EDITOR_GUIDE_MEDIA_QUERY);

    const syncVisibility = () => {
      let dismissedValue: string | null = null;
      try {
        dismissedValue = window.localStorage.getItem(DESKTOP_EDITOR_GUIDE_STORAGE_KEY);
      } catch {
        // Local storage is optional. The guide still works for the current visit.
      }

      const shouldShow = shouldShowDesktopEditorGuide({
        enabled,
        desktopMediaMatches: desktopMedia.matches,
        dismissedValue,
      });
      setOpen(shouldShow && !sessionClosedRef.current);
    };

    const timer = window.setTimeout(syncVisibility, 350);
    desktopMedia.addEventListener("change", syncVisibility);
    return () => {
      window.clearTimeout(timer);
      desktopMedia.removeEventListener("change", syncVisibility);
    };
  }, [enabled, mounted]);

  const closeForSession = useCallback(() => {
    sessionClosedRef.current = true;
    setOpen(false);
  }, []);

  const dismissPermanently = useCallback(() => {
    try {
      window.localStorage.setItem(DESKTOP_EDITOR_GUIDE_STORAGE_KEY, "1");
    } catch {
      // Closing the current guide still works if storage is unavailable.
    }
    closeForSession();
  }, [closeForSession]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.body.style.overflow = "hidden";
    cardRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    cardRef.current?.focus();
  }, [open, stepIndex]);

  useEffect(() => {
    if (!open || !targetSelector) {
      setTargetRect(null);
      return;
    }

    let frame = 0;
    let activeTarget: Element | null = null;

    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        activeTarget = document.querySelector(targetSelector);
        setTargetRect(elementRect(activeTarget));
      });
    };

    activeTarget = document.querySelector(targetSelector);
    activeTarget?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    measure();

    const observer = new MutationObserver(measure);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    document.addEventListener("scroll", measure, true);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, true);
    };
  }, [open, targetSelector]);

  const spotlightStyle = useMemo(() => {
    if (!targetRect || !mounted) return undefined;
    const left = Math.max(8, targetRect.left - SPOTLIGHT_PADDING);
    const top = Math.max(8, targetRect.top - SPOTLIGHT_PADDING);
    const right = Math.min(window.innerWidth - 8, targetRect.right + SPOTLIGHT_PADDING);
    const bottom = Math.min(window.innerHeight - 8, targetRect.bottom + SPOTLIGHT_PADDING);
    return {
      left,
      top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }, [mounted, targetRect]);

  const cardStyle = useMemo(() => {
    if (!targetRect || !mounted) {
      return {
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
      };
    }

    const width = Math.min(400, window.innerWidth - 32);
    const left = Math.max(16, Math.min(
      targetRect.left + targetRect.width / 2 - width / 2,
      window.innerWidth - width - 16,
    ));
    const fitsBelow = targetRect.bottom + CARD_GAP + ESTIMATED_CARD_HEIGHT <= window.innerHeight - 16;
    const top = fitsBelow
      ? targetRect.bottom + CARD_GAP
      : Math.max(16, targetRect.top - CARD_GAP - ESTIMATED_CARD_HEIGHT);
    return { left, top, width, transform: "none" };
  }, [mounted, targetRect]);

  if (!mounted || !open || !step) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="desktop-editor-guide-title"
      aria-describedby="desktop-editor-guide-description"
      onKeyDown={(event) => {
        if (event.key === "Escape") closeForSession();
      }}
    >
      {spotlightStyle
        ? <div
            className="pointer-events-none fixed rounded-2xl border-2 border-[#ff5447] transition-all duration-300"
            style={{
              ...spotlightStyle,
              boxShadow: "0 0 0 9999px rgba(3, 3, 5, 0.82), 0 0 28px rgba(255, 84, 71, 0.5)",
            }}
            aria-hidden="true"
          />
        : <div className="pointer-events-none fixed inset-0 bg-black/85 backdrop-blur-[2px]" aria-hidden="true" />}

      <section
        ref={cardRef}
        tabIndex={-1}
        className={`fixed overflow-hidden rounded-2xl border border-white/15 bg-[#171719] text-white shadow-2xl outline-none ${
          isLastStep
            ? "w-[min(340px,calc(100vw-32px))]"
            : "w-[min(400px,calc(100vw-32px))]"
        }`}
        style={cardStyle}
      >
        <div className="h-1 bg-gradient-to-r from-[#ff4338] via-[#ff766d] to-[#ff4338]" />
        <div className="p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <span className="text-[11px] font-extrabold tracking-[0.14em] text-[#ff786e]">
                {step.eyebrow}
              </span>
              <p className="mt-1 text-xs font-semibold text-neutral-500">
                {activeStepIndex + 1} / {guideSteps.length}
              </p>
            </div>
            <button
              type="button"
              className="-mr-2 -mt-2 grid h-9 w-9 place-items-center rounded-full text-neutral-400 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6b60]"
              aria-label="편집 가이드 닫기"
              onClick={closeForSession}
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden="true">
                <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <h2 id="desktop-editor-guide-title" className="text-xl font-extrabold leading-snug">
            {step.title}
          </h2>
          <p id="desktop-editor-guide-description" className="mt-3 text-sm leading-6 text-neutral-300">
            {step.description}
          </p>

          {isLastStep
            ? <div className="mt-6 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="h-11 rounded-xl border border-white/15 bg-white/5 px-3 text-sm font-bold transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  onClick={closeForSession}
                >
                  확인
                </button>
                <button
                  type="button"
                  className="h-11 rounded-xl bg-[#ff493e] px-3 text-sm font-extrabold text-white transition hover:bg-[#ff5e54] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6b60]"
                  onClick={dismissPermanently}
                >
                  다시 보지 않기
                </button>
              </div>
            : <div className="mt-6 flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="h-10 rounded-lg px-3 text-sm font-bold text-neutral-400 transition hover:bg-white/5 hover:text-white disabled:invisible"
                  disabled={activeStepIndex === 0}
                  onClick={() => setStepIndex(Math.max(0, activeStepIndex - 1))}
                >
                  이전
                </button>
                <button
                  type="button"
                  className="h-10 min-w-24 rounded-lg bg-white px-4 text-sm font-extrabold text-black transition hover:bg-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  onClick={() => setStepIndex(Math.min(
                    guideSteps.length - 1,
                    activeStepIndex + 1,
                  ))}
                >
                  다음
                </button>
              </div>}
        </div>
      </section>
    </div>,
    document.body,
  );
}
