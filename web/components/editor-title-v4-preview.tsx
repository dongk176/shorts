"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  createElement,
  type PointerEventHandler,
} from "react";
import type { TitleTextStyle } from "@/lib/contracts";
import { ensureEditorFontFaceV4Loaded } from "@/lib/editor-fonts";
import type { EditorRenderTitleSpecV4 } from "@/lib/editor-render-spec";
import {
  styledTitleLineRuns,
  titleLineCharacterIndices,
} from "@/lib/title-preview";

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;

type BackgroundRect = {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  radius: number;
};

function percentX(value: number) {
  return `${value / CANVAS_WIDTH * 100}%`;
}

function percentY(value: number) {
  return `${value / CANVAS_HEIGHT * 100}%`;
}

function utf16Offset(value: string, codePointOffset: number) {
  return Array.from(value).slice(0, codePointOffset).join("").length;
}

export function EditorTitleV4Preview({
  spec,
  sourceTitle,
  textStyles,
  primaryColor,
  accentColor,
  selected = false,
  editing = false,
  editValue = "",
  zIndex = 10,
  onPointerDown,
  onEditStart,
  onEditValueChange,
  onEditEnd,
}: {
  spec: EditorRenderTitleSpecV4;
  sourceTitle: string;
  textStyles: TitleTextStyle[];
  primaryColor: string;
  accentColor: string;
  selected?: boolean;
  editing?: boolean;
  editValue?: string;
  zIndex?: number;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  onEditStart?: () => void;
  onEditValueChange?: (value: string) => void;
  onEditEnd?: () => void;
}) {
  const textRefs = useRef<Array<SVGTextElement | null>>([]);
  const exactFontFaceRef = useRef(spec.font);
  exactFontFaceRef.current = spec.font;
  const exactFontKey = [
    spec.font.fontId,
    spec.font.fileId,
    spec.font.family,
    spec.font.requestedWeight,
    spec.font.resolvedWeight,
    spec.font.variableWeight ?? "static",
    spec.font.sha256,
    spec.font.metrics.revision,
  ].join(":");
  const [readyExactFontKey, setReadyExactFontKey] = useState<string | null>(
    null,
  );
  const exactFontReady = readyExactFontKey === exactFontKey;
  const [backgroundRects, setBackgroundRects] = useState<BackgroundRect[]>([]);
  const lineIndices = useMemo(
    () => titleLineCharacterIndices(sourceTitle, spec.lines),
    [sourceTitle, spec.lines],
  );
  const lineRuns = useMemo(() => spec.lines.map((line, index) => (
    styledTitleLineRuns(line, lineIndices[index], textStyles)
  )), [lineIndices, spec.lines, textStyles]);

  useEffect(() => {
    let cancelled = false;
    void ensureEditorFontFaceV4Loaded(exactFontFaceRef.current, sourceTitle)
      .then(() => {
        if (!cancelled) setReadyExactFontKey(exactFontKey);
      })
      .catch(() => {
        if (!cancelled) {
          setReadyExactFontKey((current) => (
            current === exactFontKey ? null : current
          ));
        }
      });
    return () => { cancelled = true; };
  }, [exactFontKey, sourceTitle]);

  useEffect(() => {
    if (!spec.visible || !exactFontReady) return;
    let cancelled = false;
    const resolveBackgrounds = () => {
      if (cancelled) return;
      const next = spec.lineBoxes.flatMap((box, lineIndex) => {
        const text = textRefs.current[lineIndex];
        return box.backgroundRuns.flatMap((run, runIndex): BackgroundRect[] => {
          const key = `${lineIndex}:${runIndex}:${run.start}:${run.end}`;
          if (
            run.x !== undefined
            && run.y !== undefined
            && run.width !== undefined
            && run.height !== undefined
            && run.radius !== undefined
          ) {
            return [{
              key,
              x: run.x,
              y: run.y,
              width: run.width,
              height: run.height,
              color: run.color,
              radius: run.radius,
            }];
          }
          if (!text) return [];
          const start = utf16Offset(box.text, run.start);
          const end = utf16Offset(box.text, run.end);
          if (end <= start) return [];
          try {
            const first = text.getStartPositionOfChar(start);
            const last = text.getEndPositionOfChar(end - 1);
            return [{
              key,
              x: first.x - spec.linePaddingX,
              y: box.centerY - box.height / 2,
              width: last.x - first.x + spec.linePaddingX * 2,
              height: box.height,
              color: run.color,
              radius: Math.max(6, Math.round(spec.fontSize * 0.14)),
            }];
          } catch {
            return [];
          }
        });
      });
      setBackgroundRects(next);
    };
    resolveBackgrounds();
    void document.fonts?.ready.then(resolveBackgrounds);
    return () => { cancelled = true; };
  }, [exactFontReady, spec]);

  if (!spec.visible || !exactFontReady) return null;
  const minX = Math.min(...spec.lineBoxes.map((box) => box.centerX - box.width / 2));
  const maxX = Math.max(...spec.lineBoxes.map((box) => box.centerX + box.width / 2));
  const minY = Math.min(...spec.lineBoxes.map((box) => box.centerY - box.height / 2));
  const maxY = Math.max(...spec.lineBoxes.map((box) => box.centerY + box.height / 2));

  return <div
    data-editor-v4-title-preview=""
    className="pointer-events-none absolute inset-0 overflow-visible"
    style={{ zIndex }}
  >
    <svg
      aria-hidden="true"
      className="absolute inset-0 h-full w-full overflow-visible"
      viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
      preserveAspectRatio="none"
    >
      {backgroundRects.map((rect) => <rect
          key={rect.key}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          rx={rect.radius}
          fill={rect.color}
        />)}
      {spec.lineBoxes.map((box, lineIndex) => {
        const advanceWidth = box.width - spec.linePaddingX * 2;
        return createElement("text", {
          key: `${box.text}:${lineIndex}`,
          ref: (element: SVGTextElement | null) => {
            textRefs.current[lineIndex] = element;
          },
          x: box.centerX - advanceWidth / 2,
          y: box.baselineY,
          textLength: advanceWidth,
          lengthAdjust: "spacingAndGlyphs",
          fontFamily: spec.font.family,
          fontSize: spec.fontSize,
          fontWeight: spec.font.resolvedWeight,
          xmlSpace: "preserve",
        }, ...lineRuns[lineIndex].map((run, runIndex) => createElement(
          "tspan",
          {
            key: `${run.text}:${runIndex}`,
            fill: run.color || (lineIndex > 0 ? accentColor : primaryColor),
          },
          run.text,
        )));
      })}
    </svg>
    {editing && onEditValueChange && onEditEnd
      ? <textarea
          autoFocus
          data-editor-overlay-layer="title"
          aria-label="제목 직접 편집"
          value={editValue}
          maxLength={80}
          rows={2}
          spellCheck={false}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => onEditValueChange(event.target.value)}
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
          className="pointer-events-auto absolute resize-none overflow-hidden border-0 bg-black/45 text-center font-bold outline outline-2 outline-[#ff715e]"
          style={{
            left: percentX(minX),
            top: percentY(minY),
            width: percentX(maxX - minX),
            height: percentY(maxY - minY),
            color: primaryColor,
            fontFamily: spec.font.family,
            fontSize: `${spec.fontSize / 10.8}cqw`,
            fontWeight: spec.font.resolvedWeight,
          }}
        />
      : onPointerDown && <button
          type="button"
          data-editor-overlay-layer="title"
          aria-label="제목 오버레이 선택 및 이동"
          aria-pressed={selected}
          onPointerDown={onPointerDown}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onEditStart?.();
          }}
          className={`pointer-events-auto absolute cursor-move border-0 bg-transparent p-0 ${selected ? "outline outline-2 outline-[#ff715e]" : ""}`}
          style={{
            left: percentX(minX),
            top: percentY(minY),
            width: percentX(maxX - minX),
            height: percentY(maxY - minY),
          }}
        />}
  </div>;
}
