"use client";
import { useUiText } from "@/lib/i18n/use-ui-text";

import { useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent, RefObject } from "react";

function timelineBounds(workspaceHeight: number) {
  // Keep enough room above the divider to operate the preview and settings.
  const max = Math.max(132, Math.floor(workspaceHeight - 220));
  const min = Math.min(300, max);
  return { min, max, defaultHeight: Math.min(max, Math.max(min, Math.min(380, Math.round(workspaceHeight / 2)))) };
}

export function EditorTimelineResizer({ workspaceRef, timelineId }: {
  workspaceRef: RefObject<HTMLDivElement | null>;
  timelineId: string;
}) {
  const ui = useUiText();
  const handleRef = useRef<HTMLDivElement>(null);
  const preferredHeight = useRef<number | null>(null);
  const drag = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const [size, setSize] = useState({ min: 300, max: 600, height: 380 });
  const [resizing, setResizing] = useState(false);

  const applyHeight = (requested: number | null) => {
    const workspace = workspaceRef.current;
    if (!workspace || !window.matchMedia("(min-width: 641px)").matches) return;
    const bounds = timelineBounds(workspace.clientHeight);
    const height = Math.round(Math.min(bounds.max, Math.max(bounds.min, requested ?? bounds.defaultHeight)));
    workspace.style.setProperty("--studio-timeline-height", `${height}px`);
    setSize((current) => current.height === height && current.min === bounds.min && current.max === bounds.max
      ? current : { min: bounds.min, max: bounds.max, height });
  };

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const sync = () => {
      if (!window.matchMedia("(min-width: 641px)").matches) {
        workspace.style.removeProperty("--studio-timeline-height");
        drag.current = null;
        setResizing(false);
        return;
      }
      const bounds = timelineBounds(workspace.clientHeight);
      const height = Math.round(Math.min(bounds.max, Math.max(bounds.min, preferredHeight.current ?? bounds.defaultHeight)));
      workspace.style.setProperty("--studio-timeline-height", `${height}px`);
      setSize((current) => current.height === height && current.min === bounds.min && current.max === bounds.max
        ? current : { min: bounds.min, max: bounds.max, height });
    };
    const observer = new ResizeObserver(sync);
    observer.observe(workspace);
    sync();
    return () => {
      observer.disconnect();
      workspace.style.removeProperty("--studio-timeline-height");
    };
  }, [workspaceRef]);

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <div
    ref={handleRef}
    className={`editor-timeline-resizer${resizing ? " is-resizing" : ""}`}
    role="separator"
    tabIndex={0}
    aria-label={ui("타임라인 높이 조절")}
    aria-orientation="horizontal"
    aria-controls={timelineId}
    aria-valuemin={size.min}
    aria-valuemax={size.max}
    aria-valuenow={size.height}
    aria-valuetext={`${size.height}px`}
    title={ui("위아래로 드래그하여 높이 조절 · 두 번 클릭하여 기본 높이로")}
    onPointerDown={(event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      event.stopPropagation();
      const height = event.currentTarget.parentElement?.getBoundingClientRect().height ?? size.height;
      drag.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height };
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      setResizing(true);
    }}
    onPointerMove={(event) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const bounds = timelineBounds(workspaceRef.current?.clientHeight ?? 0);
      const height = Math.min(bounds.max, Math.max(bounds.min, current.startHeight + current.startY - event.clientY));
      preferredHeight.current = height;
      applyHeight(height);
    }}
    onPointerUp={finishDrag}
    onPointerCancel={finishDrag}
    onLostPointerCapture={() => { drag.current = null; setResizing(false); }}
    onDoubleClick={() => { preferredHeight.current = null; applyHeight(null); }}
    onKeyDown={(event) => {
      const step = event.shiftKey ? 64 : 24;
      const next = event.key === "ArrowUp" ? size.height + step
        : event.key === "ArrowDown" ? size.height - step
          : event.key === "Home" ? size.min
            : event.key === "End" ? size.max
              : event.key === "Enter" ? null : undefined;
      if (next === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      preferredHeight.current = next === null ? null : Math.min(size.max, Math.max(size.min, next));
      applyHeight(preferredHeight.current);
    }}
  ><span aria-hidden="true" /></div>;
}
