"use client";

import { useEffect, useMemo, useState, type PointerEventHandler } from "react";
import {
  FlowSubtitleWords,
  PositionedSubtitleWords,
} from "@/components/positioned-subtitle-words";
import { customCanvasWidth } from "@/lib/custom-template-preview-layout";
import {
  editorFontFamily,
  ensureEditorFontFaceV4Loaded,
  resolveEditorFontFace,
  resolveEditorFontFaceV4,
} from "@/lib/editor-fonts";
import {
  compileTemplateSubtitlePreviewGeometryV4,
  type TemplateSubtitlePreviewWord,
} from "@/lib/template-subtitle-preview-v4";
import { TEMPLATE_CANVAS, type TemplateConfigV5 } from "@/lib/template-config";

export function TemplateSubtitlePreview({
  subtitle,
  selected = false,
  onPointerDown,
  positionedWordsV4Enabled = false,
}: {
  subtitle: TemplateConfigV5["subtitle"];
  selected?: boolean;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  positionedWordsV4Enabled?: boolean;
}) {
  if (!subtitle.visible) return null;
  const previewWords = subtitle.variant === "pop"
    ? [
        { text: "자막", active: true, spaceBefore: false },
        { text: "입니다", active: false, spaceBefore: true },
      ]
    : [
        { text: "이게", active: false, spaceBefore: false },
        { text: "바로", active: false, spaceBefore: true },
        { text: "자막입니다", active: true, spaceBefore: true },
      ];
  if (positionedWordsV4Enabled) return <ExactTemplateSubtitlePreview
    subtitle={subtitle}
    previewWords={previewWords}
    selected={selected}
    onPointerDown={onPointerDown}
  />;
  const font = resolveEditorFontFace(subtitle.fontId, "title");
  const content = (
    <span className="flex items-center justify-center gap-[.18em] whitespace-nowrap">
      {previewWords.map((word) => {
        const active = word.active;
        return (
          <span
            key={word.text}
            style={{
              color: active ? subtitle.accentColor : subtitle.color,
              display: "inline-block",
              transform: active && subtitle.variant === "pop" ? "scale(1.12)" : undefined,
              transformOrigin: "center",
            }}
          >
            {word.text}
          </span>
        );
      })}
    </span>
  );
  const style = {
    left: "50%",
    top: `${(subtitle.y / TEMPLATE_CANVAS.height) * 100}%`,
    width: customCanvasWidth(subtitle.maxWidth),
    transform: "translate(-50%, -50%)",
    color: subtitle.color,
    fontFamily: editorFontFamily(subtitle.fontId),
    fontSize: customCanvasWidth(subtitle.fontSize),
    fontWeight: font.resolvedWeight,
    lineHeight: 1.2,
    textShadow: "0 0 .08em #080808, .035em .035em 0 #080808, -.035em -.035em 0 #080808, .035em -.035em 0 #080808, -.035em .035em 0 #080808",
  } as const;

  if (onPointerDown) {
    return (
      <button
        type="button"
        aria-label="자막 세로 위치 이동"
        aria-pressed={selected}
        onPointerDown={onPointerDown}
        className={`absolute z-[45] cursor-ns-resize rounded text-center ${selected ? "outline outline-2 outline-[#ff715e]" : ""}`}
        style={style}
      >
        {content}
      </button>
    );
  }

  return <div className="pointer-events-none absolute z-[45] rounded text-center" style={style}>{content}</div>;
}

function ExactTemplateSubtitlePreview({
  subtitle,
  previewWords,
  selected,
  onPointerDown,
}: {
  subtitle: TemplateConfigV5["subtitle"];
  previewWords: TemplateSubtitlePreviewWord[];
  selected: boolean;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
}) {
  const positionedFont = useMemo(
    () => resolveEditorFontFaceV4(subtitle.fontId, "title"),
    [subtitle.fontId],
  );
  const sample = previewWords.map((word) => word.text).join(" ");
  const fontLoadKey = `${subtitle.fontId}:${sample}`;
  const [loadedFontKey, setLoadedFontKey] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoadedFontKey(null);
    void ensureEditorFontFaceV4Loaded(positionedFont, sample).then(() => {
      if (!cancelled) setLoadedFontKey(fontLoadKey);
    }).catch(() => {
      if (!cancelled) setLoadedFontKey(null);
    });
    return () => {
      cancelled = true;
    };
  }, [fontLoadKey, positionedFont, sample]);

  const exactGeometry = useMemo(() => {
    if (loadedFontKey !== fontLoadKey) return null;
    try {
      return compileTemplateSubtitlePreviewGeometryV4(
        subtitle,
        previewWords,
      );
    } catch {
      return null;
    }
  }, [fontLoadKey, loadedFontKey, previewWords, subtitle]);
  if (!exactGeometry) return null;

  if (subtitle.variant === "pop") {
    const visual = (
      <PositionedSubtitleWords
        words={previewWords.map((word) => ({
          text: word.text,
          fontSize: subtitle.fontSize,
        }))}
        positions={exactGeometry.positions}
        activeWordIndex={previewWords.findIndex((word) => word.active)}
        activeWordScale={1.12}
        cssToAssScale={exactGeometry.cssToAssScale}
        cssToAssBaselineOffsetEm={exactGeometry.cssToAssBaselineOffsetEm}
        textColor={subtitle.color}
        accentColor={subtitle.accentColor}
        fontFamily={positionedFont.family}
        fontWeight={positionedFont.resolvedWeight}
        textStyle={{
          textShadow: "0 0 .08em #080808, .035em .035em 0 #080808, -.035em -.035em 0 #080808, .035em -.035em 0 #080808, -.035em .035em 0 #080808",
        }}
        className="pointer-events-none absolute inset-0 z-[45]"
      />
    );
    if (!onPointerDown) return visual;
    return <>
      {visual}
      <button
        type="button"
        aria-label="자막 세로 위치 이동"
        aria-pressed={selected}
        onPointerDown={onPointerDown}
        className={`absolute z-[46] cursor-ns-resize rounded ${selected ? "outline outline-2 outline-[#ff715e]" : ""}`}
        style={{
          left: `${(subtitle.x / TEMPLATE_CANVAS.width) * 100}%`,
          top: `${(subtitle.y / TEMPLATE_CANVAS.height) * 100}%`,
          width: customCanvasWidth(subtitle.maxWidth),
          height: customCanvasWidth(
            subtitle.fontSize * exactGeometry.cssToAssScale * 1.35,
          ),
          transform: "translate(-50%, -50%)",
        }}
      />
    </>;
  }

  const maximumWidth = subtitle.maxWidth - 14;
  const scaleX = exactGeometry.rawPhraseWidth > maximumWidth
    ? Math.round(
        Math.min(100, maximumWidth / exactGeometry.rawPhraseWidth * 100),
      ) / 100
    : 1;
  const highlightContent = <FlowSubtitleWords
    words={previewWords.map((word) => ({
      text: word.text,
      fontSize: subtitle.fontSize,
      spaceBefore: word.spaceBefore,
    }))}
    lines={[previewWords.map((_word, index) => index)]}
    activeWordIndex={previewWords.findIndex((word) => word.active)}
    separatorAdvanceWidth={exactGeometry.separatorAdvanceWidth}
    textColor={subtitle.color}
    accentColor={subtitle.accentColor}
    pixelToCss={customCanvasWidth}
  />;
  const highlightStyle = {
    left: `${(subtitle.x / TEMPLATE_CANVAS.width) * 100}%`,
    top: `${((
      subtitle.y
      + subtitle.fontSize * exactGeometry.cssToAssBaselineOffsetEm
    ) / TEMPLATE_CANVAS.height) * 100}%`,
    width: customCanvasWidth(subtitle.maxWidth),
    transform: `translate(-50%, -50%) scaleX(${scaleX})`,
    color: subtitle.color,
    fontFamily: positionedFont.family,
    fontSize: customCanvasWidth(
      subtitle.fontSize * exactGeometry.cssToAssScale,
    ),
    fontWeight: positionedFont.resolvedWeight,
    lineHeight: 1.2,
    textShadow: "0 0 .08em #080808, .035em .035em 0 #080808, -.035em -.035em 0 #080808, .035em -.035em 0 #080808, -.035em .035em 0 #080808",
  } as const;
  if (onPointerDown) return <button
    type="button"
    aria-label="자막 세로 위치 이동"
    aria-pressed={selected}
    onPointerDown={onPointerDown}
    className={`absolute z-[45] cursor-ns-resize whitespace-nowrap rounded text-center ${selected ? "outline outline-2 outline-[#ff715e]" : ""}`}
    style={highlightStyle}
  >{highlightContent}</button>;
  return <div
    className="pointer-events-none absolute z-[45] whitespace-nowrap rounded text-center"
    style={highlightStyle}
  >{highlightContent}</div>;
}
