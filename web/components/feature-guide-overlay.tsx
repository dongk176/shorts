"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  type GuideTargetRect,
  resolveGuideSpotlightGeometry,
} from "@/lib/feature-guide-geometry";

export type FeatureGuideStep = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  targetSelector: string | null;
  placement?: "auto" | "right" | "left" | "above" | "below";
  scrollBlock?: "nearest" | "center";
};

const SPOTLIGHT_PADDING = 9;
const SPOTLIGHT_VIEWPORT_MARGIN = 2;
const CARD_GAP = 18;
const ESTIMATED_CARD_HEIGHT = 290;
const GUIDE_SCROLL_LISTENER_OPTIONS = { capture: true, passive: true } as const;
const GUIDE_TONE_STYLES = {
  coral: {
    spotlightClassName: "border-[#ff5447]",
    spotlightShadow: "0 0 0 9999px rgba(3, 3, 5, 0.82), 0 0 28px rgba(255, 84, 71, 0.5)",
    focusRingColor: "rgba(255, 84, 71, 0.72)",
    accentBarClassName: "from-[#ff4338] via-[#ff766d] to-[#ff4338]",
    eyebrowClassName: "text-[#ff786e]",
    closeFocusClassName: "focus-visible:outline-[#ff6b60]",
    dismissClassName: "bg-[#ff493e] hover:bg-[#ff5e54] focus-visible:outline-[#ff6b60]",
  },
  blue: {
    spotlightClassName: "border-[#3b82f6]",
    spotlightShadow: "0 0 0 9999px rgba(3, 3, 5, 0.82), 0 0 28px rgba(59, 130, 246, 0.55)",
    focusRingColor: "rgba(59, 130, 246, 0.78)",
    accentBarClassName: "from-[#1d4ed8] via-[#60a5fa] to-[#1d4ed8]",
    eyebrowClassName: "text-[#60a5fa]",
    closeFocusClassName: "focus-visible:outline-[#60a5fa]",
    dismissClassName: "bg-[#2563eb] hover:bg-[#3b82f6] focus-visible:outline-[#60a5fa]",
  },
} as const;

export type FeatureGuideTone = keyof typeof GUIDE_TONE_STYLES;

function elementRect(element: Element | null): GuideTargetRect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const style = window.getComputedStyle(element);
  const borderRadius = Math.max(
    Number.parseFloat(style.borderTopLeftRadius) || 0,
    Number.parseFloat(style.borderTopRightRadius) || 0,
    Number.parseFloat(style.borderBottomRightRadius) || 0,
    Number.parseFloat(style.borderBottomLeftRadius) || 0,
  );
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    borderRadius,
  };
}

function targetNeedsScroll(rect: GuideTargetRect) {
  const margin = 16;
  return rect.top < margin
    || rect.left < margin
    || rect.bottom > window.innerHeight - margin
    || rect.right > window.innerWidth - margin;
}

export function FeatureGuideOverlay({
  enabled,
  steps,
  storageKey,
  mediaQuery,
  closeAriaLabel,
  tone = "coral",
  smoothTransitions = false,
  onClose,
  lastStepSecondaryLabel = "확인",
  lastStepPrimaryLabel = "다시 보지 않기",
  onLastStepPrimaryAction,
}: {
  enabled: boolean;
  steps: readonly FeatureGuideStep[];
  storageKey: string;
  mediaQuery?: string;
  closeAriaLabel: string;
  tone?: FeatureGuideTone;
  smoothTransitions?: boolean;
  onClose?: () => void;
  lastStepSecondaryLabel?: string;
  lastStepPrimaryLabel?: string;
  onLastStepPrimaryAction?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<GuideTargetRect | null>(null);
  const sessionClosedRef = useRef(false);
  const cardRef = useRef<HTMLElement>(null);
  const activeStepIndex = Math.max(0, Math.min(stepIndex, Math.max(0, steps.length - 1)));
  const step = steps[activeStepIndex];
  const targetSelector = step?.targetSelector ?? null;
  const isLastStep = activeStepIndex === steps.length - 1;
  const toneStyles = GUIDE_TONE_STYLES[tone];

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const media = mediaQuery ? window.matchMedia(mediaQuery) : null;

    const syncVisibility = () => {
      let dismissedValue: string | null = null;
      try {
        dismissedValue = window.localStorage.getItem(storageKey);
      } catch {
        // Local storage is optional. The guide still works for the current visit.
      }

      const shouldShow = enabled
        && steps.length > 0
        && (media?.matches ?? true)
        && dismissedValue !== "1";
      setOpen(shouldShow && !sessionClosedRef.current);
    };

    const timer = window.setTimeout(syncVisibility, 350);
    media?.addEventListener("change", syncVisibility);
    return () => {
      window.clearTimeout(timer);
      media?.removeEventListener("change", syncVisibility);
    };
  }, [enabled, mediaQuery, mounted, steps.length, storageKey]);

  const closeForSession = useCallback(() => {
    sessionClosedRef.current = true;
    setOpen(false);
    onClose?.();
  }, [onClose]);

  const dismissPermanently = useCallback(() => {
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Closing the current guide still works if storage is unavailable.
    }
    closeForSession();
    onLastStepPrimaryAction?.();
  }, [closeForSession, onLastStepPrimaryAction, storageKey]);

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

  const trackTarget = useCallback((stabilizeBeforePaint: boolean) => {
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
    const initialRect = elementRect(activeTarget);
    const shouldCenterTarget = step.scrollBlock === "center";
    if (
      initialRect
      && (shouldCenterTarget || !stabilizeBeforePaint || targetNeedsScroll(initialRect))
    ) {
      activeTarget?.scrollIntoView({
        block: step.scrollBlock || "nearest",
        inline: "nearest",
        behavior: "auto",
      });
    }
    if (stabilizeBeforePaint) {
      setTargetRect(elementRect(activeTarget));
    }
    measure();

    const observer = new MutationObserver(measure);
    observer.observe(document.body, { childList: true, subtree: true });
    const resizeObserver = new ResizeObserver(measure);
    if (activeTarget) resizeObserver.observe(activeTarget);
    window.addEventListener("resize", measure);
    document.addEventListener("scroll", measure, GUIDE_SCROLL_LISTENER_OPTIONS);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, GUIDE_SCROLL_LISTENER_OPTIONS);
    };
  }, [open, step.scrollBlock, targetSelector]);

  useLayoutEffect(() => {
    if (!smoothTransitions) return;
    return trackTarget(true);
  }, [smoothTransitions, trackTarget]);

  useEffect(() => {
    if (smoothTransitions) return;
    return trackTarget(false);
  }, [smoothTransitions, trackTarget]);

  const spotlightStyle = useMemo(() => {
    if (!targetRect || !mounted) return undefined;
    return resolveGuideSpotlightGeometry({
      target: targetRect,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      requestedPadding: SPOTLIGHT_PADDING,
      viewportMargin: SPOTLIGHT_VIEWPORT_MARGIN,
      devicePixelRatio: window.devicePixelRatio,
    });
  }, [mounted, targetRect]);

  const cardStyle = useMemo(() => {
    if (!mounted) {
      return {
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
      };
    }

    const width = Math.min(isLastStep ? 340 : 400, window.innerWidth - 32);
    if (!targetRect) {
      return {
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
      };
    }

    const centeredLeft = Math.max(16, Math.min(
      targetRect.left + targetRect.width / 2 - width / 2,
      window.innerWidth - width - 16,
    ));
    const targetGap = SPOTLIGHT_PADDING + CARD_GAP;
    const placement = step.placement || "auto";
    if (placement === "right" || placement === "left") {
      const rightSideLeft = targetRect.right + targetGap;
      const leftSideLeft = targetRect.left - targetGap - width;
      const preferredLeft = placement === "right"
        ? rightSideLeft
        : leftSideLeft;
      const fallbackLeft = placement === "right"
        ? leftSideLeft
        : rightSideLeft;
      const horizontalLeft = preferredLeft >= 16
        && preferredLeft + width <= window.innerWidth - 16
        ? preferredLeft
        : fallbackLeft >= 16
          && fallbackLeft + width <= window.innerWidth - 16
          ? fallbackLeft
          : centeredLeft;
      const top = Math.max(16, Math.min(
        targetRect.top,
        window.innerHeight - ESTIMATED_CARD_HEIGHT - 16,
      ));
      return {
        left: horizontalLeft,
        top,
        width,
        transform: "none",
      };
    }
    if (placement === "above" || placement === "below") {
      const aboveTop = targetRect.top - targetGap - ESTIMATED_CARD_HEIGHT;
      const belowTop = targetRect.bottom + targetGap;
      const preferredTop = placement === "above" ? aboveTop : belowTop;
      const fallbackTop = placement === "above" ? belowTop : aboveTop;
      const verticalTop = preferredTop >= 16
        && preferredTop + ESTIMATED_CARD_HEIGHT <= window.innerHeight - 16
        ? preferredTop
        : fallbackTop >= 16
          && fallbackTop + ESTIMATED_CARD_HEIGHT <= window.innerHeight - 16
          ? fallbackTop
          : Math.max(16, Math.min(
              preferredTop,
              window.innerHeight - ESTIMATED_CARD_HEIGHT - 16,
            ));
      return {
        left: centeredLeft,
        top: verticalTop,
        width,
        transform: "none",
      };
    }
    const fitsBelow = targetRect.bottom + CARD_GAP + ESTIMATED_CARD_HEIGHT <= window.innerHeight - 16;
    const top = fitsBelow
      ? targetRect.bottom + CARD_GAP
      : Math.max(16, targetRect.top - CARD_GAP - ESTIMATED_CARD_HEIGHT);
    return {
      left: centeredLeft,
      top,
      width,
      transform: "none",
    };
  }, [
    isLastStep,
    mounted,
    step.placement,
    targetRect,
  ]);

  if (!mounted || !open || !step) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feature-guide-title"
      aria-describedby="feature-guide-description"
      data-feature-guide-tone={tone}
      onKeyDown={(event) => {
        if (event.key === "Escape") closeForSession();
      }}
    >
      {spotlightStyle
          ? <div
            className={`pointer-events-none fixed border-2 ${smoothTransitions ? "transition-[left,top,width,height,border-radius] duration-200 ease-out" : ""} ${toneStyles.spotlightClassName}`}
            style={{
              ...spotlightStyle,
              boxShadow: toneStyles.spotlightShadow,
            }}
            aria-hidden="true"
          />
        : <div className="pointer-events-none fixed inset-0 bg-black/85 backdrop-blur-[2px]" aria-hidden="true" />}

      <section
        ref={cardRef}
        tabIndex={-1}
        className={`fixed overflow-hidden rounded-2xl border border-white/15 bg-[#171719] text-white shadow-2xl outline-none ${smoothTransitions ? "transition-[left,top,width,transform] duration-200 ease-out" : ""} ${
          isLastStep
            ? "w-[min(340px,calc(100vw-32px))]"
            : "w-[min(400px,calc(100vw-32px))]"
        }`}
        style={{ ...cardStyle, outlineColor: toneStyles.focusRingColor }}
      >
        <div className={`h-1 bg-gradient-to-r ${toneStyles.accentBarClassName}`} />
        <div className="p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <span className={`text-[11px] font-extrabold tracking-[0.14em] ${toneStyles.eyebrowClassName}`}>
                {step.eyebrow}
              </span>
              <p className="mt-1 text-xs font-semibold text-neutral-500">
                {activeStepIndex + 1} / {steps.length}
              </p>
            </div>
            <button
              type="button"
              className={`-mr-2 -mt-2 grid h-9 w-9 place-items-center rounded-full text-neutral-400 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${toneStyles.closeFocusClassName}`}
              aria-label={closeAriaLabel}
              onClick={closeForSession}
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden="true">
                <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <h2 id="feature-guide-title" className="text-xl font-extrabold leading-snug">
            {step.title}
          </h2>
          <p id="feature-guide-description" className="mt-3 text-sm leading-6 text-neutral-300">
            {step.description}
          </p>

          {isLastStep
            ? <div className="mt-6 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="h-11 rounded-xl border border-white/15 bg-white/5 px-3 text-sm font-bold transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  onClick={closeForSession}
                >
                  {lastStepSecondaryLabel}
                </button>
                <button
                  type="button"
                  className={`h-11 rounded-xl px-3 text-sm font-extrabold text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${toneStyles.dismissClassName}`}
                  onClick={dismissPermanently}
                >
                  {lastStepPrimaryLabel}
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
                    steps.length - 1,
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
