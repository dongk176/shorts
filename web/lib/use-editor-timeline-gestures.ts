"use client";

import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { attachTimelineZoomGestures, type TimelineZoomAnchor } from "./editor-timeline-gestures";

export function useEditorTimelineGestures(
  areaRef: RefObject<HTMLDivElement | null>,
  surface: "video" | "overlay" | null,
  zoom: number,
  onZoom: (zoom: number, anchor?: TimelineZoomAnchor) => void,
  min: number,
  max: number,
) {
  const latest = useRef({ zoom, onZoom });
  useLayoutEffect(() => { latest.current = { zoom, onZoom }; }, [zoom, onZoom]);
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!surface || !area) return;
    return attachTimelineZoomGestures(area, {
      min, max,
      getZoom: () => latest.current.zoom,
      onZoom: (value, anchor) => {
        latest.current.zoom = value;
        latest.current.onZoom(value, anchor);
      },
    });
  }, [areaRef, surface, min, max]);
}
