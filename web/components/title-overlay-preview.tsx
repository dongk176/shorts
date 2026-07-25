"use client";

import { useEffect, useMemo, useState } from "react";
import type { TitleTextStyle, VideoAspectRatio } from "@/lib/contracts";
import { COMMENT_CAPTURE_LANDSCAPE_LIFT_PX } from "@/lib/template-config";
import {
  fitPreviewTitleFont,
  titleLineCharacterIndices,
  titleLineColor,
  wrapPreviewTitle,
} from "@/lib/title-preview";

const CANVAS_WIDTH = 1080;
const TITLE_LINE_GAP = 18;
const TITLE_FONT_FAMILY = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

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

function styledLineRuns(line: string, indices: Array<number | null>, styles: TitleTextStyle[]) {
  const runs: Array<{ text: string; color?: string; backgroundColor?: string }> = [];
  Array.from(line).forEach((character, characterIndex) => {
    const titleIndex = indices[characterIndex];
    const style = titleIndex === null
      ? undefined
      : styles.find((item) => item.start <= titleIndex && item.end > titleIndex);
    const previous = runs.at(-1);
    if (previous && previous.color === style?.color && previous.backgroundColor === style?.backgroundColor) {
      previous.text += character;
    } else {
      runs.push({ text: character, color: style?.color, backgroundColor: style?.backgroundColor });
    }
  });
  return runs;
}

export function TitleOverlayPreview({
  title,
  fontScale,
  videoAspectRatio,
  primary,
  accent,
  background,
  keepPrimaryFirstLine = false,
  textStyles = [],
  liftLandscape = false,
}: {
  title: string;
  fontScale: number;
  videoAspectRatio: VideoAspectRatio;
  primary: string;
  accent: string;
  background: string;
  keepPrimaryFirstLine?: boolean;
  textStyles?: TitleTextStyle[];
  liftLandscape?: boolean;
}) {
  const lines = useMemo(() => wrapPreviewTitle(title), [title]);
  const lineIndices = useMemo(() => titleLineCharacterIndices(title, lines), [lines, title]);
  const [fittedFontSize, setFittedFontSize] = useState(() => fitPreviewTitleFont(lines));
  const layout = titlePanelLayout(videoAspectRatio, liftLandscape);
  const bottomMargin = layout.panelHeight === 285 && !layout.overlay
    ? 12
    : Math.min(44, Math.max(24, Math.round(layout.panelHeight * 0.105)));
  const scaledFontSize = Math.max(18, Math.min(100, Math.round(fittedFontSize * fontScale)));

  useEffect(() => {
    let cancelled = false;
    const fitUsingBrowserFont = () => {
      const context = document.createElement("canvas").getContext("2d");
      if (!context || cancelled) return;
      const fitted = fitPreviewTitleFont(lines, (line, fontSize) => {
        context.font = `700 ${fontSize}px ${TITLE_FONT_FAMILY}`;
        return context.measureText(line).width;
      });
      if (!cancelled) setFittedFontSize(fitted);
    };
    fitUsingBrowserFont();
    void document.fonts?.ready.then(fitUsingBrowserFont);
    return () => { cancelled = true; };
  }, [lines]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" style={{ containerType: "inline-size" }}>
      <div
        className="absolute inset-x-0 flex flex-col items-center justify-end overflow-hidden text-center font-bold"
        style={{
          top: layout.top,
          height: layout.height,
          gap: canvasWidth(TITLE_LINE_GAP),
          paddingBottom: canvasWidth(bottomMargin),
          background: layout.overlay ? "transparent" : background,
          fontFamily: TITLE_FONT_FAMILY,
          fontSize: canvasWidth(scaledFontSize),
          lineHeight: 1,
        }}
      >
        {lines.map((line, index) => {
          return (
            <span
              key={`${line}-${index}`}
              className="max-w-full shrink-0 whitespace-nowrap"
              style={{
                color: titleLineColor(index, layout.overlay, primary, accent, keepPrimaryFirstLine),
                background: "transparent",
              }}
            >
              {styledLineRuns(line, lineIndices[index], textStyles).map((run, runIndex) => (
                <span
                  key={`${run.text}-${runIndex}`}
                  style={{
                    color: run.color || "inherit",
                    background: run.backgroundColor || "transparent",
                    borderRadius: run.backgroundColor ? "0.12em" : 0,
                    boxDecorationBreak: "clone",
                    display: run.backgroundColor ? "inline-block" : "inline",
                    padding: run.backgroundColor ? "0.14em 0.34em" : 0,
                    WebkitBoxDecorationBreak: "clone",
                  }}
                >
                  {run.text}
                </span>
              ))}
            </span>
          );
        })}
      </div>
    </div>
  );
}
