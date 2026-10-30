"use client";
import { useUiText } from "@/lib/i18n/use-ui-text";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { rankingTime } from "@/lib/ranking-shorts";

export function RankingTimeline({
  src,
  duration,
  start,
  end,
  current,
  disabled,
  onChange,
  onSeek,
}: {
  src: string;
  duration: number;
  start: number;
  end: number;
  current: number;
  disabled: boolean;
  onChange: (start: number, end: number) => void;
  onSeek: (seconds: number) => void;
}) {
  const ui = useUiText();
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    edge: "start" | "end";
    start: number;
    end: number;
  } | null>(null);
  const move = useRef<{ origin: number; start: number; end: number } | null>(
    null,
  );
  const [frames, setFrames] = useState<string[]>([]);
  useEffect(() => {
    if (!src) return;
    let disposed = false;
    const video = document.createElement("video");
    video.muted = true;
    video.crossOrigin = "anonymous";
    setFrames([]);
    video.preload = "auto";
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 72;
    const context = canvas.getContext("2d");
    const collected: string[] = [];
    let index = 0;
    function capture() {
      if (disposed || !context) return;
      try {
        context.drawImage(video, 0, 0, 128, 72);
        collected.push(canvas.toDataURL("image/jpeg", 0.65));
      } catch {
        video.removeAttribute("src"); video.load(); return;
      }
      index += 1;
      if (index < 10) video.currentTime = (duration * (index + 0.5)) / 10;
      else {
        setFrames(collected);
        video.removeAttribute("src");
        video.load();
      }
    }
    video.onloadedmetadata = () => {
      video.currentTime = duration * 0.05;
    };
    video.onseeked = capture;
    video.src = src;
    return () => {
      disposed = true;
      video.onseeked = null;
      video.onloadedmetadata = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [src, duration]);

  function update(
    edge: "start" | "end",
    value: number,
    bounds = { start, end },
  ) {
    if (!Number.isFinite(value) || disabled) return;
    // Dragging one handle never shifts the other handle.
    if (edge === "start") {
      const next =
        Math.round(
          Math.max(0, bounds.end - 60, Math.min(value, bounds.end - 0.5)) *
            1000,
        ) / 1000;
      onChange(next, bounds.end);
      onSeek(next);
    } else {
      const next = Math.max(
        bounds.start + 0.5,
        Math.min(duration, bounds.start + 60, Math.round(value * 1000) / 1000),
      );
      onChange(bounds.start, next);
      onSeek(Math.max(bounds.start, next - 1 / 30));
    }
  }
  function valueAt(clientX: number) {
    const rect = track.current!.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(duration, ((clientX - rect.left) / rect.width) * duration),
    );
  }
  function begin(
    edge: "start" | "end",
    event: PointerEvent<HTMLButtonElement>,
  ) {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = { edge, start, end };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  return (
    <div className="ranking-trim">
      <div className="ranking-timeline-scroll">
        <div className="ranking-timeline-width">
          <div
            ref={track}
            className="ranking-filmstrip"
            onPointerDown={(event) => {
              if (!disabled) onSeek(valueAt(event.clientX));
            }}
          >
            <div className="ranking-filmstrip-images" aria-hidden="true">
              {Array.from({ length: 10 }, (_, index) => (
                <span
                  key={index}
                  style={
                    frames[index]
                      ? { backgroundImage: `url(${frames[index]})` }
                      : undefined
                  }
                />
              ))}
            </div>
            <div
              className="ranking-trim-shade"
              style={{ left: 0, width: `${(start / duration) * 100}%` }}
            />
            <div
              className="ranking-trim-shade"
              style={{ left: `${(end / duration) * 100}%`, right: 0 }}
            />
            <div
              className="ranking-trim-selection"
              style={{
                left: `${(start / duration) * 100}%`,
                width: `${((end - start) / duration) * 100}%`,
              }}
              onPointerDown={(event) => {
                if (disabled) return;
                event.preventDefault();
                event.stopPropagation();
                move.current = { origin: valueAt(event.clientX), start, end };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!move.current || disabled) return;
                const {
                  origin,
                  start: initialStart,
                  end: initialEnd,
                } = move.current;
                const offset = Math.max(
                  -initialStart,
                  Math.min(
                    duration - initialEnd,
                    valueAt(event.clientX) - origin,
                  ),
                );
                onChange(initialStart + offset, initialEnd + offset);
                onSeek(initialStart + offset);
              }}
              onPointerUp={(event) => {
                move.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => {
                move.current = null;
              }}
              onLostPointerCapture={() => {
                move.current = null;
              }}
            />
            {(["start", "end"] as const).map((edge) => (
              <button
                key={edge}
                type="button"
                role="slider"
                disabled={disabled}
                aria-label={edge === "start" ? ui("시작점") : ui("끝점")}
                aria-valuemin={
                  edge === "start" ? Math.max(0, end - 60) : start + 0.5
                }
                aria-valuemax={
                  edge === "start" ? end - 0.5 : Math.min(duration, start + 60)
                }
                aria-valuenow={edge === "start" ? start : end}
                aria-valuetext={rankingTime(edge === "start" ? start : end)}
                className={`ranking-trim-handle is-${edge}`}
                style={{
                  left: `${((edge === "start" ? start : end) / duration) * 100}%`,
                }}
                onPointerDown={(event) => begin(edge, event)}
                onPointerMove={(event) => {
                  if (drag.current?.edge === edge)
                    update(edge, valueAt(event.clientX), drag.current);
                }}
                onPointerUp={(event) => {
                  drag.current = null;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => {
                  drag.current = null;
                }}
                onLostPointerCapture={() => {
                  drag.current = null;
                }}
                onKeyDown={(event) => {
                  const value = edge === "start" ? start : end;
                  const step = event.shiftKey ? 1 : 0.1;
                  if (
                    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                      event.key,
                    )
                  ) {
                    event.preventDefault();
                    update(
                      edge,
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? duration
                          : value + (event.key === "ArrowLeft" ? -step : step),
                    );
                  }
                }}
              >
                <span
                  className="ranking-handle-time"
                  style={
                    edge === "start"
                      ? start / duration < 0.08
                        ? { left: 0, right: "auto" }
                        : { right: 0, left: "auto" }
                      : end / duration > 0.92
                        ? { right: 0, left: "auto" }
                        : { left: 0, right: "auto" }
                  }
                >
                  {rankingTime(edge === "start" ? start : end)}
                </span>
                <span className="ranking-handle-grip" />
              </button>
            ))}
            <span
              className="ranking-playhead"
              style={{ left: `${Math.min(100, (current / duration) * 100)}%` }}
            />
          </div>
          <div className="ranking-timeline-ruler" aria-hidden="true">
            {[0, 0.25, 0.5, 0.75, 1].map((value) => (
              <span key={value}>{rankingTime(value * duration)}</span>
            ))}
          </div>
        </div>
      </div>
      <p className="ranking-hint">
        {ui("양끝 손잡이를 드래그해 장면을 고르세요. 순위당 최대 60초.")}</p>
    </div>
  );
}
