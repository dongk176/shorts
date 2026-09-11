"use client";

import { useEffect, type RefObject } from "react";

export function useCreatorViewport(
  surface: RefObject<HTMLElement | null>,
  content: RefObject<HTMLDivElement | null>,
  isIntro: boolean,
) {
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      const height = viewport?.height ?? window.innerHeight;
      const width = viewport?.width ?? window.innerWidth;
      const top = viewport?.offsetTop ?? 0;
      element.style.setProperty("--creator-overlay-height", `${height}px`);
      element.style.setProperty("--creator-overlay-top", `${top}px`);
      element.style.setProperty("--creator-overlay-left", `${viewport?.offsetLeft ?? 0}px`);
      element.style.setProperty("--creator-overlay-width", `${width}px`);

      // Follow BOTH the keyboard's resize and iOS's visual-viewport pan.
      // Freeze layout while pinch-zoomed so users can magnify and pan normally.
      if (Math.abs((viewport?.scale ?? 1) - 1) > .01) return;
      const layoutHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
      element.style.setProperty("--creator-viewport-height", `${height}px`);
      // Some WebViews briefly retain an old offset after the keyboard closes.
      element.style.setProperty("--creator-viewport-top", `${Math.min(top, Math.max(0, layoutHeight - height))}px`);
      element.dataset.compact = String(height < 450);

      const pane = content.current;
      const input = document.activeElement;
      if (isIntro || !pane || !(input instanceof HTMLInputElement) || !pane.contains(input)) return;
      const area = pane.getBoundingClientRect();
      const field = input.getBoundingClientRect();
      const gap = Math.min(12, Math.max(0, (area.height - field.height) / 2));
      // Scroll only the input pane, never the page or footer. This keeps the
      // selected field above the pinned actions after keyboard/focus changes.
      if (field.bottom > area.bottom - gap) pane.scrollTop += field.bottom - area.bottom + gap;
      else if (field.top < area.top + gap) pane.scrollTop -= area.top + gap - field.top;
    };
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    update();
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    element.addEventListener("focusin", schedule);
    const observer = new ResizeObserver(schedule);
    if (content.current) observer.observe(content.current);
    return () => {
      window.cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      element.removeEventListener("focusin", schedule);
      observer.disconnect();
    };
  }, [surface, content, isIntro]);
}
