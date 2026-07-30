import type { CSSProperties, PointerEventHandler } from "react";
import {
  customCanvasWidth,
  customCenteredLayerStyle,
} from "@/lib/custom-template-preview-layout";
import type { TitleTextStyle } from "@/lib/contracts";
import type { TemplateConfig } from "@/lib/template-config";
import {
  styledTitleLineRuns,
  titleLineCharacterIndices,
} from "@/lib/title-preview";

const DEFAULT_TITLE_FONT_FAMILY = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

export function CustomTemplateTitlePreview({
  title,
  sourceTitle,
  firstLine,
  secondLine,
  fontScale = 1,
  fontFamily = DEFAULT_TITLE_FONT_FAMILY,
  textStyles = [],
  selected = false,
  editing = false,
  editValue = "",
  movementStyle,
  onPointerDown,
  onEditStart,
  onEditValueChange,
  onEditEnd,
}: {
  title: TemplateConfig["title"];
  sourceTitle?: string;
  firstLine: string;
  secondLine: string;
  fontScale?: number;
  fontFamily?: string;
  textStyles?: TitleTextStyle[];
  selected?: boolean;
  editing?: boolean;
  editValue?: string;
  movementStyle?: CSSProperties;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  onEditStart?: () => void;
  onEditValueChange?: (value: string) => void;
  onEditEnd?: () => void;
}) {
  if (!title.visible) return null;
  const fontSize = title.fontSize * fontScale;
  const visibleLines = [firstLine, ...(secondLine ? [secondLine] : [])];
  const lineIndices = titleLineCharacterIndices(
    sourceTitle || visibleLines.join("\n"),
    visibleLines,
  );
  const wrapperStyle = {
    ...customCenteredLayerStyle(title),
    gap: customCanvasWidth(Math.max(6, Math.round(fontSize * 0.18))),
    fontFamily,
    fontSize: customCanvasWidth(fontSize),
    lineHeight: 1,
    ...movementStyle,
  };
  const lineStyle = (accent: boolean) => ({
    borderRadius: customCanvasWidth(Math.max(6, Math.round(fontSize * 0.14))),
    color: accent ? title.accentColor : title.primaryColor,
    backgroundColor: (accent ? title.accentBackgroundColor : title.primaryBackgroundColor) || "transparent",
    padding: `${customCanvasWidth(Math.max(6, Math.round(fontSize * 0.14)))} ${customCanvasWidth(Math.max(10, Math.round(fontSize * 0.28)))}`,
  });
  const lines = visibleLines.map((line, lineIndex) => (
    <span
      key={`${line}-${lineIndex}`}
      className="whitespace-nowrap"
      style={lineStyle(lineIndex === 1)}
    >
      {styledTitleLineRuns(
        line,
        lineIndices[lineIndex],
        textStyles,
      ).map((run, runIndex) => (
        <span
          key={`${run.text}-${runIndex}`}
          style={{
            color: run.color || "inherit",
            backgroundColor: run.backgroundColor || "transparent",
            borderRadius: run.backgroundColor ? "0.12em" : 0,
            boxDecorationBreak: "clone",
            display: run.backgroundColor ? "inline-block" : "inline",
            padding: run.backgroundColor ? "0.1em 0.22em" : 0,
            WebkitBoxDecorationBreak: "clone",
          }}
        >
          {run.text}
        </span>
      ))}
    </span>
  ));

  if (onPointerDown) {
    if (editing && onEditValueChange && onEditEnd) {
      return <textarea
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
        className="absolute z-20 resize-none overflow-hidden border-0 bg-black/45 px-[1.5cqw] py-[.8cqw] text-center font-bold outline outline-2 outline-[#ff715e]"
        style={{
          ...wrapperStyle,
          minHeight: "2.3em",
          color: title.primaryColor,
        }}
      />;
    }
    return <button type="button" data-editor-overlay-layer="title" aria-label="제목 위치 이동" aria-pressed={selected} onPointerDown={onPointerDown} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); onEditStart?.(); }} title="더블클릭해서 제목 수정" className={`absolute z-20 flex cursor-move flex-col items-center text-center font-bold ${selected ? "outline outline-2 outline-[#ff715e]" : ""}`} style={wrapperStyle}>{lines}</button>;
  }
  return <div className="absolute z-20 flex flex-col items-center text-center font-bold" style={wrapperStyle}>{lines}</div>;
}
