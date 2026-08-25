import type { PointerEventHandler } from "react";
import { customCanvasWidth } from "@/lib/custom-template-preview-layout";
import { editorFontFamily, resolveEditorFontFace } from "@/lib/editor-fonts";
import { TEMPLATE_CANVAS, type TemplateConfigV5 } from "@/lib/template-config";

export function TemplateSubtitlePreview({
  subtitle,
  selected = false,
  onPointerDown,
}: {
  subtitle: TemplateConfigV5["subtitle"];
  selected?: boolean;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
}) {
  if (!subtitle.visible) return null;
  const font = resolveEditorFontFace(subtitle.fontId, "title");
  const previewWords = subtitle.variant === "pop"
    ? [
        { text: "자막", active: true },
        { text: "입니다", active: false },
      ]
    : [
        { text: "이게", active: false },
        { text: "바로", active: false },
        { text: "자막입니다", active: true },
      ];
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
