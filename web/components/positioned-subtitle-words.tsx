import { Fragment, type CSSProperties } from "react";
import type {
  PositionedSubtitleWord,
  PositionedSubtitleWordBox,
} from "@/components/positioned-subtitle-layout";

export {
  POSITIONED_SUBTITLE_JOINED_WORD_GAP_PX,
  POSITIONED_SUBTITLE_WORD_GAP_PX,
  centeredAdvanceWordBoxes,
} from "@/components/positioned-subtitle-layout";
export type {
  PositionedSubtitleWord,
  PositionedSubtitleWordBox,
} from "@/components/positioned-subtitle-layout";

export function PositionedSubtitleWords({
  words,
  positions,
  activeWordIndex,
  activeWordScale = 1,
  canvasWidth = 1_080,
  canvasHeight = 1_920,
  layoutScale = 1,
  offsetY = 0,
  cssToAssScale,
  cssToAssBaselineOffsetEm = 0,
  textColor,
  accentColor,
  fontFamily,
  fontWeight,
  textStyle,
  className = "pointer-events-none absolute inset-0",
}: {
  words: readonly PositionedSubtitleWord[];
  positions: readonly PositionedSubtitleWordBox[];
  activeWordIndex?: number;
  activeWordScale?: number;
  canvasWidth?: number;
  canvasHeight?: number;
  layoutScale?: number;
  offsetY?: number;
  cssToAssScale: number;
  cssToAssBaselineOffsetEm?: number;
  textColor: string;
  accentColor: string;
  fontFamily?: string;
  fontWeight?: CSSProperties["fontWeight"];
  textStyle?: CSSProperties;
  className?: string;
}) {
  if (
    words.length !== positions.length
    || !Number.isFinite(cssToAssScale)
    || cssToAssScale < 0.5
    || cssToAssScale > 1.5
  ) return null;
  const canvasCenterX = canvasWidth / 2;
  const canvasWidthUnit = canvasWidth / 100;
  const canvasHeightUnit = canvasHeight / 100;

  return (
    <span
      data-caption-layout-mode="absolute-word-positions-v1"
      data-css-to-ass-scale={cssToAssScale}
      className={className}
      aria-hidden="true"
    >
      {words.map((word, index) => {
        const position = positions[index];
        if (!position) return null;
        const active = index === activeWordIndex;
        const transformedCenterX = canvasCenterX
          + (position.centerX - canvasCenterX) * layoutScale;
        const baselineOffset = word.fontSize
          * cssToAssBaselineOffsetEm
          * layoutScale
          * (active ? activeWordScale : 1);
        return (
          <span
            key={`${index}-${word.text}`}
            data-positioned-subtitle-word=""
            data-advance-width={position.advanceWidth}
            data-gap-before={position.gapBefore}
            className="absolute block whitespace-nowrap text-center"
            style={{
              left: `${transformedCenterX / canvasWidthUnit}%`,
              top: `${(position.centerY + offsetY + baselineOffset) / canvasHeightUnit}%`,
              width: `${position.advanceWidth * layoutScale / canvasWidthUnit}cqw`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <span
              className="inline-block"
              style={{
                ...textStyle,
                color: active ? accentColor : textColor,
                fontFamily,
                fontSize: `${word.fontSize * layoutScale * cssToAssScale / canvasWidthUnit}cqw`,
                fontWeight,
                lineHeight: 1,
                transform: active && activeWordScale !== 1
                  ? `scale(${activeWordScale})`
                  : undefined,
                transformOrigin: "center",
              }}
            >{word.text}</span>
          </span>
        );
      })}
    </span>
  );
}

export function FlowSubtitleWords({
  words,
  lines,
  activeWordIndex,
  separatorAdvanceWidth,
  textColor,
  accentColor,
  pixelToCss = (value) => `${value}px`,
}: {
  words: readonly PositionedSubtitleWord[];
  lines: readonly (readonly number[])[];
  activeWordIndex?: number;
  separatorAdvanceWidth: number;
  textColor: string;
  accentColor: string;
  pixelToCss?: (pixels: number) => string;
}) {
  if (!Number.isFinite(separatorAdvanceWidth) || separatorAdvanceWidth < 0) {
    return null;
  }
  return <>
    {lines.map((line, lineIndex) => <span key={lineIndex} className="block">
      {line.map((wordIndex, linePosition) => {
        const word = words[wordIndex];
        if (!word) return null;
        const separated = linePosition > 0
          && Boolean((word as PositionedSubtitleWord & { spaceBefore?: boolean })
            .spaceBefore);
        return <Fragment key={wordIndex}>
          {separated && <span
            data-flow-subtitle-separator=""
            className="inline-block"
            style={{ width: pixelToCss(separatorAdvanceWidth) }}
          />}
          <span
            data-flow-subtitle-word=""
            data-word-index={wordIndex}
            className="inline-block"
            style={{
              color: activeWordIndex === wordIndex ? accentColor : textColor,
            }}
          >{word.text}</span>
        </Fragment>;
      })}
    </span>)}
  </>;
}
