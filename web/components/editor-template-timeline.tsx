"use client";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useUiText } from "@/lib/i18n/use-ui-text";
import { attachTimelineZoomGestures, type TimelineZoomAnchor } from "@/lib/editor-timeline-gestures";
import { EditorTimelineResizer } from "./editor-timeline-resizer";
import { EditorTimelineRuler } from "./editor-timeline-ruler";
import { EditorViewportZoomControl } from "./editor-studio-chrome";
import { timelineThumbnailCount, useTimelineThumbnails } from "@/lib/use-timeline-thumbnails";

export function templateEditorTime(seconds: number) {
  const value = Math.max(0, seconds);
  return `${Math.floor(value / 60)}:${(value % 60).toFixed(1).padStart(4, "0")}`;
}
export function EditorTemplateTimeline({ workspaceRef, id, videoUrl, min, max, start, end, time, disabled, onSeek, onRangeChange, onCheckpoint, layers }: {
  workspaceRef: RefObject<HTMLDivElement | null>; id: string; min: number; max: number;
  videoUrl: string;
  start: number; end: number; time: number; disabled: boolean;
  onSeek: (time: number) => void; onRangeChange: (edge: "start" | "end", value: number) => void; onCheckpoint: () => void;
  layers: { label: string; selected: boolean; onSelect: () => void }[];
}) {
  const ui = useUiText();
  const thumbnails = useTimelineThumbnails(videoUrl);
  const area = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  const anchor = useRef<TimelineZoomAnchor | null>(null);
  const drag = useRef<{ id: number; edge: "start" | "end" } | null>(null);
  const duration = Math.max(3, max - min);
  const left = (start - min) / duration * 100;
  const width = (end - start) / duration * 100;
  useEffect(() => {
    if (!area.current) return;
    return attachTimelineZoomGestures(area.current, { getZoom: () => zoomRef.current, min: 1, max: 3,
      onZoom: (value, point) => { anchor.current = point; setZoom(value); } });
  }, []);
  useLayoutEffect(() => {
    zoomRef.current = zoom;
    if (area.current && anchor.current) {
      area.current.scrollLeft = anchor.current.ratio * area.current.scrollWidth - anchor.current.viewportX;
      anchor.current = null;
    }
  }, [zoom]);
  const update = (edge: "start" | "end", value: number) => {
    if (disabled || !Number.isFinite(value)) return;
    onRangeChange(edge, Math.round(Math.max(edge === "start" ? min : start + 3, Math.min(edge === "start" ? end - 3 : max, value)) * 10) / 10);
  };
  return <section id={id} className="editor-workspace-timeline template-timeline" aria-label={ui("영상 구간 선택")}>
    <EditorTimelineResizer workspaceRef={workspaceRef} timelineId={id} />
    <div className="template-timeline-toolbar"><strong>{ui("레이어")}</strong><span>{ui("영상 구간")} {templateEditorTime(end - start)}</span>
      <EditorViewportZoomControl label="타임라인" value={zoom} min={1} max={3} step={0.5} className="template-zoom" onChange={setZoom} />
    </div>
    <div ref={area} className="template-timeline-scroll">
      <div className="template-timeline-content" style={{ width: `${zoom * 100}%` }}>
        <div ref={track} className="template-timeline-track">
          <EditorTimelineRuler start={min} duration={duration} />
          <input className="template-playhead" aria-label={ui("재생 위치")} type="range" min={min} max={max} step="0.1" value={Math.max(min, Math.min(max, time))} onChange={e => onSeek(Number(e.target.value))} />
          <div className="template-video-frames" aria-hidden="true">
            {Array.from({ length: timelineThumbnailCount }, (_, index) => <span key={index} style={thumbnails[index] ? { backgroundImage: `url(${thumbnails[index]})` } : undefined} />)}
          </div>
          <div className="template-video-shade" aria-hidden="true" style={{ left: 0, width: `${left}%` }} />
          <div className="template-video-shade" aria-hidden="true" style={{ left: `${left + width}%`, right: 0 }} />
          <div className="template-video-range" style={{ left: `${left}%`, width: `${width}%` }}>
            {!thumbnails.length && <span>{ui("영상")}</span>}
            {(["start", "end"] as const).map(edge => <button key={edge} type="button" role="slider" className={`template-trim template-trim-${edge}`} disabled={disabled}
              aria-label={ui(edge === "start" ? "영상 시작 구간 조절" : "영상 끝 구간 조절")} aria-valuemin={edge === "start" ? min : start + 3} aria-valuemax={edge === "start" ? end - 3 : max}
              aria-valuenow={edge === "start" ? start : end} aria-valuetext={templateEditorTime(edge === "start" ? start : end)}
              onKeyDown={e => {
                const value = edge === "start" ? start : end;
                if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                  e.preventDefault(); update(edge, e.key === "Home" ? min : e.key === "End" ? max : value + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 0.1)); onCheckpoint();
                }
              }}
              onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: e.pointerId, edge }; }}
              onPointerMove={e => {
                if (drag.current?.id !== e.pointerId || !track.current) return;
                const bounds = track.current.getBoundingClientRect(); update(edge, min + (e.clientX - bounds.left) / bounds.width * duration);
              }}
              onPointerUp={() => { drag.current = null; onCheckpoint(); }} onPointerCancel={() => { drag.current = null; onCheckpoint(); }}>Ⅱ</button>)}
          </div>
        </div>
        {layers.map((layer, i) => <div className="template-layer-row" key={i}><button type="button" className={`template-layer template-layer-${i}`} aria-pressed={layer.selected}
          style={{ marginLeft: `${left}%`, width: `${width}%` }} onClick={layer.onSelect}>{layer.label}</button></div>)}
      </div>
    </div>
  </section>;
}
