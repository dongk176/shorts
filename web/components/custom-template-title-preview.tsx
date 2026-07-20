import type { PointerEventHandler } from "react";
import {
  customCanvasWidth,
  customCenteredLayerStyle,
} from "@/lib/custom-template-preview-layout";
import type { TemplateConfig } from "@/lib/template-config";

const TITLE_FONT_FAMILY = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

export function CustomTemplateTitlePreview({
  title,
  firstLine,
  secondLine,
  selected = false,
  onPointerDown,
}: {
  title: TemplateConfig["title"];
  firstLine: string;
  secondLine: string;
  selected?: boolean;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
}) {
  if (!title.visible) return null;
  const fontSize = title.fontSize;
  const wrapperStyle = {
    ...customCenteredLayerStyle(title),
    gap: customCanvasWidth(Math.max(6, Math.round(fontSize * 0.18))),
    fontFamily: TITLE_FONT_FAMILY,
    fontSize: customCanvasWidth(fontSize),
    lineHeight: 1,
  };
  const lineStyle = (accent: boolean) => ({
    borderRadius: customCanvasWidth(Math.max(6, Math.round(fontSize * 0.14))),
    color: accent ? title.accentColor : title.primaryColor,
    backgroundColor: (accent ? title.accentBackgroundColor : title.primaryBackgroundColor) || "transparent",
    padding: `${customCanvasWidth(Math.max(6, Math.round(fontSize * 0.14)))} ${customCanvasWidth(Math.max(10, Math.round(fontSize * 0.28)))}`,
  });
  const lines = <><span className="whitespace-nowrap" style={lineStyle(false)}>{firstLine}</span><span className="whitespace-nowrap" style={lineStyle(true)}>{secondLine}</span></>;

  if (onPointerDown) {
    return <button type="button" aria-label="제목 위치 이동" onPointerDown={onPointerDown} className={`absolute z-20 flex cursor-move flex-col items-center text-center font-bold ${selected ? "outline outline-2 outline-[#ff715e]" : ""}`} style={wrapperStyle}>{lines}</button>;
  }
  return <div className="absolute z-20 flex flex-col items-center text-center font-bold" style={wrapperStyle}>{lines}</div>;
}
