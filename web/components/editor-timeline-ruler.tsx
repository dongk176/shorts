"use client";
import { useUiText } from "@/lib/i18n/use-ui-text";

import { useLayoutEffect, useRef, useState } from "react";
import { editorTimelineRulerTicks } from "@/lib/editor-timeline-ruler";

export function EditorTimelineRuler({ start, duration }: { start: number; duration: number }) {
  const ui = useUiText();
  const rulerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const ruler = rulerRef.current;
    if (!ruler) return;
    const updateWidth = () => setWidth(ruler.clientWidth);
    const observer = new ResizeObserver(updateWidth);
    observer.observe(ruler);
    updateWidth();
    return () => observer.disconnect();
  }, []);

  return <div ref={rulerRef} className="editor-studio-ruler" aria-label={ui("타임라인 시간 눈금")}>
    {editorTimelineRulerTicks(start, duration, width).map((tick) => <span
      key={tick.position}
      style={{ left: `${tick.position}%` }}
    >{tick.label}</span>)}
  </div>;
}
