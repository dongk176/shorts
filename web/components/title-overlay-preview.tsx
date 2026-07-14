"use client";

import { useEffect, useMemo, useState } from "react";
import type { VideoAspectRatio } from "@/lib/contracts";
import { fitPreviewTitleFont, wrapPreviewTitle } from "@/lib/title-preview";

const CANVAS_WIDTH = 1080;
const TITLE_LINE_GAP = 18;
const TITLE_ACCENT_PADDING_X = 24;
const TITLE_ACCENT_PADDING_Y = 10;
const TITLE_RADIUS = 8;
const TITLE_FONT_FAMILY = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

function titlePanelLayout(videoAspectRatio: VideoAspectRatio) {
  if (videoAspectRatio === "9:16") {
    return { top: "5%", height: "18.75%", panelHeight: 360, overlay: true };
  }
  const videoHeights: Record<Exclude<VideoAspectRatio, "9:16">, number> = {
    "16:9": 608,
    "1:1": 1080,
    "4:5": 1350,
  };
  const panelHeight = (1920 - videoHeights[videoAspectRatio]) / 2;
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
  accentBackground,
  background,
}: {
  title: string;
  fontScale: number;
  videoAspectRatio: VideoAspectRatio;
  primary: string;
  accent: string;
  accentBackground: string | null;
  background: string;
}) {
  const lines = useMemo(() => wrapPreviewTitle(title), [title]);
  const [fittedFontSize, setFittedFontSize] = useState(() => fitPreviewTitleFont(lines));
  const layout = titlePanelLayout(videoAspectRatio);
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
          const highlighted = index === 1 && accentBackground;
          return (
            <span
              key={`${line}-${index}`}
              className="max-w-full shrink-0 whitespace-nowrap"
              style={{
                color: index === 0 ? primary : accent,
                background: highlighted ? accentBackground : "transparent",
                borderRadius: highlighted ? canvasWidth(TITLE_RADIUS) : 0,
                padding: highlighted
                  ? `${canvasWidth(TITLE_ACCENT_PADDING_Y)} ${canvasWidth(TITLE_ACCENT_PADDING_X)}`
                  : 0,
              }}
            >
              {line}
            </span>
          );
        })}
      </div>
    </div>
  );
}
