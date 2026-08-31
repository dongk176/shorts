"use client";

import { useLayoutEffect, useRef } from "react";
import type { PointerEvent, PointerEventHandler } from "react";
import {
  adjustTimedRange,
  snapTimedRangeHandle,
  TIMED_RANGE_SNAP_THRESHOLD_PX,
  timelinePointerDeltaSeconds,
  type TimedRangeAdjustment,
} from "@/lib/range-editing";
import {
  EDITOR_TEXT_DEFAULT_WIDTH,
  type EditorTextOverlay,
  type EditorTextResizeEdge,
} from "@/lib/editor-overlay-preview";
import type { EditorRenderTextLayerSpec } from "@/lib/editor-render-spec";
import {
  EditorTextOverlayLines,
  editorTextOverlayPositionStyle,
  editorTextOverlayTextStyle,
} from "@/components/editor-text-overlay-paint";

export function EditorTextOverlayPreview({
  textOverlay,
  renderSpec,
  selected,
  editing = false,
  zIndex,
  onPointerDown,
  onResizePointerDown,
  onDelete,
  onEditStart,
  onEditValueChange,
  onEditEnd,
}: {
  textOverlay: EditorTextOverlay;
  renderSpec?: EditorRenderTextLayerSpec;
  selected: boolean;
  editing?: boolean;
  zIndex?: number;
  onPointerDown: PointerEventHandler<HTMLButtonElement>;
  onResizePointerDown?: (
    edge: EditorTextResizeEdge,
    event: PointerEvent<HTMLButtonElement>,
  ) => void;
  onDelete?: (id: string) => void;
  onEditStart?: (id: string) => void;
  onEditValueChange?: (id: string, value: string) => void;
  onEditEnd?: () => void;
}) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const width = textOverlay.width ?? EDITOR_TEXT_DEFAULT_WIDTH;
  const positionStyle = editorTextOverlayPositionStyle(textOverlay, zIndex);
  const textStyle = editorTextOverlayTextStyle(textOverlay, renderSpec);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editing || !editor) return;
    editor.style.height = "0";
    editor.style.height = `${editor.scrollHeight}px`;
  }, [editing, textOverlay.text, width]);

  if (editing && onEditValueChange && onEditEnd) {
    return (
      <textarea
        autoFocus
        ref={editorRef}
        data-editor-text-overlay-id={textOverlay.id}
        aria-label="추가한 텍스트 직접 편집"
        value={textOverlay.text}
        maxLength={120}
        rows={1}
        spellCheck={false}
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => onEditValueChange(
          textOverlay.id,
          event.target.value,
        )}
        onBlur={onEditEnd}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (
            event.key === "Escape"
            || (event.key === "Enter" && (event.metaKey || event.ctrlKey))
          ) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        className="absolute z-[56] resize-none overflow-hidden whitespace-pre-wrap break-words rounded-[2cqw] border-0 bg-transparent px-[2cqw] py-[1cqw] text-center font-extrabold outline outline-[3px] outline-[#ff715e]"
        style={{ ...positionStyle, ...textStyle }}
      />
    );
  }

  return (
    <div
      data-editor-text-overlay-id={textOverlay.id}
      className={`absolute z-[55] rounded-[2.4cqw] ${selected ? "outline outline-[3px] outline-[#ff715e]" : ""}`}
      style={positionStyle}
    >
      <button
        type="button"
        aria-label="추가한 텍스트 선택 및 이동"
        aria-pressed={selected}
        onPointerDown={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          onPointerDown(event);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onEditStart?.(textOverlay.id);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Delete" && event.key !== "Backspace") return;
          event.preventDefault();
          event.stopPropagation();
          onDelete?.(textOverlay.id);
        }}
        title="더블클릭해서 텍스트 수정"
        className="w-full cursor-move touch-none appearance-none whitespace-pre-wrap break-words rounded-[2cqw] border-0 bg-transparent px-[2cqw] py-[1cqw] text-center font-extrabold"
        style={textStyle}
      >
        <EditorTextOverlayLines textOverlay={textOverlay} renderSpec={renderSpec} />
      </button>
      {selected && onResizePointerDown && <>
        <button
          type="button"
          aria-label="추가한 텍스트 왼쪽 폭 조절"
          className="absolute left-[-1.7cqw] top-1/2 h-[13cqw] w-[3.4cqw] -translate-y-1/2 cursor-ew-resize touch-none rounded-full border-2 border-white bg-[#ff715e] shadow-[0_3px_10px_rgba(0,0,0,.45)]"
          onPointerDown={(event) => onResizePointerDown("left", event)}
        />
        <button
          type="button"
          aria-label="추가한 텍스트 오른쪽 폭 조절"
          className="absolute right-[-1.7cqw] top-1/2 h-[13cqw] w-[3.4cqw] -translate-y-1/2 cursor-ew-resize touch-none rounded-full border-2 border-white bg-[#ff715e] shadow-[0_3px_10px_rgba(0,0,0,.45)]"
          onPointerDown={(event) => onResizePointerDown("right", event)}
        />
      </>}
    </div>
  );
}

type ActiveTextRangeDrag = {
  pointerId: number;
  captureTarget: HTMLButtonElement;
  adjustment: TimedRangeAdjustment;
  startClientX: number;
  startClientY: number;
  width: number;
  initialRange: {
    startSeconds: number;
    endSeconds: number;
  };
  moved: boolean;
  interactionStarted: boolean;
};

export function EditorTextTimeline({
  textOverlay,
  selected,
  durationSeconds,
  currentSeconds,
  selectionLeftPercent,
  selectionWidthPercent,
  snapPointsSeconds = [],
  onRangeChange,
  onSeek,
  onSelect,
  onEdit,
  onInteractionStart,
  onInteractionEnd,
}: {
  textOverlay: EditorTextOverlay;
  selected: boolean;
  durationSeconds: number;
  currentSeconds: number;
  selectionLeftPercent: number;
  selectionWidthPercent: number;
  snapPointsSeconds?: number[];
  onRangeChange: (range: { startSeconds: number; endSeconds: number }) => void;
  onSeek: (seconds: number) => void;
  onSelect: () => void;
  onEdit: () => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<ActiveTextRangeDrag | null>(null);
  const lastTouchActivationRef = useRef<number | null>(null);
  const safeDuration = Math.max(0.3, durationSeconds);
  const startSeconds = Math.max(0, Math.min(safeDuration, textOverlay.startSeconds));
  const endSeconds = Math.max(
    Math.min(safeDuration, startSeconds + 0.3),
    Math.min(safeDuration, textOverlay.endSeconds),
  );
  const left = startSeconds / safeDuration * 100;
  const width = Math.max(0, (endSeconds - startSeconds) / safeDuration * 100);
  const previewActive = startSeconds <= currentSeconds && endSeconds > currentSeconds;

  useLayoutEffect(() => {
    if (!selected) return;
    const panel = panelRef.current;
    const scroller = panel?.closest<HTMLElement>(".editor-overlay-timeline-lanes");
    if (!panel || !scroller) return;
    const panelRect = panel.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    if (panelRect.top < scrollerRect.top) {
      scroller.scrollTop -= scrollerRect.top - panelRect.top;
    } else if (panelRect.bottom > scrollerRect.bottom) {
      scroller.scrollTop += panelRect.bottom - scrollerRect.bottom;
    }
  }, [selected]);

  const updateRange = (
    adjustment: TimedRangeAdjustment,
    deltaSeconds: number,
    initialRange = { startSeconds, endSeconds },
    snapThresholdSeconds = 0,
  ) => {
    const range = snapTimedRangeHandle(
      adjustTimedRange(
        initialRange,
        adjustment,
        deltaSeconds,
        safeDuration,
        0,
        safeDuration,
      ),
      adjustment,
      snapPointsSeconds,
      snapThresholdSeconds,
      0,
      safeDuration,
    );
    onRangeChange(range);
    onSeek(
      adjustment === "end"
        ? Math.max(range.startSeconds, range.endSeconds - 0.05)
        : range.startSeconds,
    );
  };

  const startDrag = (
    adjustment: TimedRangeAdjustment,
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0 || !trackRef.current) return;
    dragRef.current = {
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      adjustment,
      startClientX: event.clientX,
      startClientY: event.clientY,
      width: trackRef.current.getBoundingClientRect().width,
      initialRange: { startSeconds, endSeconds },
      moved: false,
      interactionStarted: false,
    };
    event.stopPropagation();
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId || active.width <= 0) return;
    const distance = event.clientX - active.startClientX;
    const verticalDistance = event.clientY - active.startClientY;
    if (!active.moved) {
      if (Math.max(Math.abs(distance), Math.abs(verticalDistance)) < 5) return;
      if (active.adjustment === "move" && event.pointerType !== "mouse") {
        dragRef.current = null;
        lastTouchActivationRef.current = null;
        return;
      }
      if (Math.abs(verticalDistance) > Math.abs(distance)) {
        dragRef.current = null;
        lastTouchActivationRef.current = null;
        return;
      }
      active.moved = true;
      active.interactionStarted = true;
      onSelect();
      onInteractionStart();
      if (!active.captureTarget.hasPointerCapture(active.pointerId)) {
        active.captureTarget.setPointerCapture(active.pointerId);
      }
    }
    updateRange(
      active.adjustment,
      timelinePointerDeltaSeconds(distance, active.width, safeDuration),
      active.initialRange,
      safeDuration * TIMED_RANGE_SNAP_THRESHOLD_PX / active.width,
    );
    event.preventDefault();
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (active.captureTarget.hasPointerCapture(event.pointerId)) {
      active.captureTarget.releasePointerCapture(event.pointerId);
    }
    if (active.interactionStarted) onInteractionEnd();
    if (active.moved || event.type !== "pointerup") {
      lastTouchActivationRef.current = null;
      return;
    }
    if (event.pointerType !== "mouse") {
      const previousActivation = lastTouchActivationRef.current;
      if (
        previousActivation !== null
        && event.timeStamp - previousActivation <= 450
      ) {
        lastTouchActivationRef.current = null;
        onEdit();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      lastTouchActivationRef.current = event.timeStamp;
    }
    onSelect();
    onSeek(active.initialRange.startSeconds);
  };

  const adjustWithKeyboard = (
    adjustment: TimedRangeAdjustment,
    direction: -1 | 1,
  ) => {
    onSelect();
    onInteractionStart();
    updateRange(adjustment, direction * 0.1);
    onInteractionEnd();
  };

  return (
    <section
      ref={panelRef}
      className={`editor-text-timeline-panel${selected ? " is-selected" : ""}`}
      aria-label={`${textOverlay.text || "텍스트"} 노출 구간 편집`}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onEdit();
      }}
    >
      <span className="editor-text-timeline-label">텍스트</span>
      <div
        className="editor-text-selection-lane"
        style={{
          left: `${selectionLeftPercent}%`,
          width: `${selectionWidthPercent}%`,
        }}
      >
        <div
          ref={trackRef}
          className="editor-text-timeline"
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          <div
            className={`editor-text-range${previewActive ? " is-preview-active" : ""}`}
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            <button
              type="button"
              className="editor-text-range-body"
              aria-label="텍스트 노출 구간 이동"
              title={textOverlay.text}
              onPointerDown={(event) => startDrag("move", event)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                adjustWithKeyboard("move", event.key === "ArrowLeft" ? -1 : 1);
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              {textOverlay.text || "텍스트"}
            </button>
            <button
              type="button"
              className="editor-text-range-handle is-start"
              aria-label="텍스트 시작점 조절"
              onPointerDown={(event) => startDrag("start", event)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                adjustWithKeyboard("start", event.key === "ArrowLeft" ? -1 : 1);
                event.preventDefault();
                event.stopPropagation();
              }}
            />
            <button
              type="button"
              className="editor-text-range-handle is-end"
              aria-label="텍스트 종료점 조절"
              onPointerDown={(event) => startDrag("end", event)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                adjustWithKeyboard("end", event.key === "ArrowLeft" ? -1 : 1);
                event.preventDefault();
                event.stopPropagation();
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
