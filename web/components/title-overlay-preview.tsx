"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, PointerEventHandler } from "react";
import { COMMENT_CAPTURE_LANDSCAPE_LIFT_PX } from "@/lib/template-config";
import type { TitleTextStyle, VideoAspectRatio } from "@/lib/contracts";
import {
  fitPreviewTitleFont,
  styledTitleLineRuns,
  TITLE_LINE_GAP,
  titlePreviewLineBoxHeight,
  titlePreviewLinePaddingX,
  titlePreviewLinePaddingY,
  titleLineCharacterIndices,
  titleLineColor,
  wrapPreviewTitle,
} from "@/lib/title-preview";

const CANVAS_WIDTH = 1080;
const DEFAULT_TITLE_FONT_FAMILY = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

function titlePanelLayout(videoAspectRatio: VideoAspectRatio, liftLandscape: boolean) {
  if (videoAspectRatio === "9:16") {
    return { top: "5%", height: "18.75%", panelHeight: 360, overlay: true };
  }
  const videoHeights: Record<Exclude<VideoAspectRatio, "9:16">, number> = {
    "16:9": 608,
    "5:4": 864,
    "1:1": 1080,
    "4:5": 1350,
  };
  const panelHeight = (1920 - videoHeights[videoAspectRatio]) / 2
    - (liftLandscape && videoAspectRatio === "16:9" ? COMMENT_CAPTURE_LANDSCAPE_LIFT_PX : 0);
  return { top: "0", height: `${(panelHeight / 1920) * 100}%`, panelHeight, overlay: false };
}

function canvasWidth(value: number) {
  return `${value / (CANVAS_WIDTH / 100)}cqw`;
}

export function TitleOverlayPreview({
  title,
  fontScale,
  videoAspectRatio,
  primary,
  accent,
  background,
  fontFamily = DEFAULT_TITLE_FONT_FAMILY,
  keepPrimaryFirstLine = false,
  textStyles = [],
  liftLandscape = false,
  selected = false,
  editing = false,
  movementStyle,
  onPointerDown,
  onEditStart,
  onEditValueChange,
  onEditEnd,
}: {
  title: string;
  fontScale: number;
  videoAspectRatio: VideoAspectRatio;
  primary: string;
  accent: string;
  background: string;
  fontFamily?: string;
  keepPrimaryFirstLine?: boolean;
  textStyles?: TitleTextStyle[];
  liftLandscape?: boolean;
  selected?: boolean;
  editing?: boolean;
  movementStyle?: CSSProperties;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  onEditStart?: () => void;
  onEditValueChange?: (value: string) => void;
  onEditEnd?: () => void;
}) {
  const lines = useMemo(() => wrapPreviewTitle(title), [title]);
  const lineIndices = useMemo(() => titleLineCharacterIndices(title, lines), [lines, title]);
  const [fittedFontSize, setFittedFontSize] = useState(() => fitPreviewTitleFont(lines));
  const layout = titlePanelLayout(videoAspectRatio, liftLandscape);
  const bottomMargin = layout.panelHeight === 285 && !layout.overlay
    ? 12
    : Math.min(44, Math.max(24, Math.round(layout.panelHeight * 0.105)));
  const scaledFontSize = Math.max(18, Math.min(100, Math.round(fittedFontSize * fontScale)));
  const lineRuns = useMemo(() => lines.map((line, index) => (
    styledTitleLineRuns(line, lineIndices[index], textStyles)
  )), [lineIndices, lines, textStyles]);

  useEffect(() => {
    let cancelled = false;
    const fitUsingBrowserFont = () => {
      const context = document.createElement("canvas").getContext("2d");
      if (!context || cancelled) return;
      const fitted = fitPreviewTitleFont(lines, (line, fontSize) => {
        context.font = `700 ${fontSize}px ${fontFamily}`;
        return context.measureText(line).width;
      });
      if (!cancelled) setFittedFontSize(fitted);
    };
    fitUsingBrowserFont();
    void document.fonts?.ready.then(fitUsingBrowserFont);
    return () => { cancelled = true; };
  }, [fontFamily, lines]);

  const panelStyle: CSSProperties = {
    top: layout.top,
    height: layout.height,
    paddingBottom: canvasWidth(bottomMargin),
    background: layout.overlay ? "transparent" : background,
    fontFamily,
    fontSize: canvasWidth(scaledFontSize),
    lineHeight: 1,
  };
  const content = lines.map((line, index) => {
    const runs = lineRuns[index];
    const hasBackground = runs.some((run) => Boolean(run.backgroundColor));
    const paddingX = titlePreviewLinePaddingX(scaledFontSize);
    const paddingY = titlePreviewLinePaddingY(scaledFontSize);
    return (
      <span
        key={`${line}-${index}`}
        className="flex max-w-full shrink-0 items-center justify-center whitespace-nowrap"
        style={{
          color: titleLineColor(index, layout.overlay, primary, accent, keepPrimaryFirstLine),
          background: "transparent",
          height: canvasWidth(titlePreviewLineBoxHeight(scaledFontSize, hasBackground)),
        }}
      >
        {runs.map((run, runIndex) => (
          <span
            key={`${run.text}-${runIndex}`}
            style={{
              color: run.color || "inherit",
              background: run.backgroundColor || "transparent",
              borderRadius: run.backgroundColor ? "0.12em" : 0,
              boxDecorationBreak: "clone",
              display: run.backgroundColor ? "inline-block" : "inline",
              padding: run.backgroundColor
                ? `${canvasWidth(paddingY)} ${canvasWidth(paddingX)}`
                : 0,
              WebkitBoxDecorationBreak: "clone",
            }}
          >
            {run.text}
          </span>
        ))}
      </span>
    );
  });
  const titleClassName = "absolute inset-x-0 flex flex-col items-center justify-end text-center font-bold";

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-visible" style={{ containerType: "inline-size" }}>
      {onPointerDown
        ? <div className={`${titleClassName} overflow-visible`} style={panelStyle}>
            {editing && onEditValueChange && onEditEnd
              ? <textarea
                  autoFocus
                  data-editor-overlay-layer="title"
                  aria-label="제목 직접 편집"
                  value={title}
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
                  className="pointer-events-auto w-[88cqw] resize-none overflow-hidden border-0 bg-black/45 px-[2cqw] py-[1cqw] text-center font-bold outline outline-2 outline-[#ff715e]"
                  style={{
                    minHeight: "2.25em",
                    color: primary,
                    ...movementStyle,
                  }}
                />
              : <button
                  type="button"
                  data-editor-overlay-layer="title"
                  aria-label="제목 오버레이 선택 및 세로 이동"
                  aria-pressed={selected}
                  onPointerDown={onPointerDown}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onEditStart?.();
                  }}
                  title="더블클릭해서 제목 수정"
                  className={`pointer-events-auto flex cursor-ns-resize appearance-none flex-col items-center border-0 bg-transparent p-0 ${selected ? "outline outline-2 outline-[#ff715e]" : ""}`}
                  style={{
                    gap: canvasWidth(TITLE_LINE_GAP),
                    ...movementStyle,
                  }}
                >
                  {content}
                </button>}
          </div>
        : <div className={`${titleClassName} overflow-hidden`} style={{ ...panelStyle, gap: canvasWidth(TITLE_LINE_GAP) }}>{content}</div>}
    </div>
  );
}
