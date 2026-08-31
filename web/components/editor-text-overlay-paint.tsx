import type { CSSProperties } from "react";
import { TEMPLATE_CANVAS } from "@/lib/template-config";
import {
  EDITOR_TEXT_DEFAULT_WIDTH,
  type EditorTextOverlay,
} from "@/lib/editor-overlay-preview";
import { editorFontFamily, resolveEditorFontFace } from "@/lib/editor-fonts";
import { wrapEditorRenderText, type EditorRenderTextLayerSpec } from "@/lib/editor-render-spec";

type PaintOverlay = Omit<EditorTextOverlay, "startSeconds" | "endSeconds">;

function canvasWidth(value: number) {
  return `${value / (TEMPLATE_CANVAS.width / 100)}cqw`;
}

export function editorTextOverlayPositionStyle(
  textOverlay: PaintOverlay,
  zIndex?: number,
): CSSProperties {
  return {
    zIndex,
    left: "50%",
    top: "50%",
    width: canvasWidth(textOverlay.width ?? EDITOR_TEXT_DEFAULT_WIDTH),
    translate: `calc(-50% + ${canvasWidth(textOverlay.offset.x)}) calc(-50% + ${canvasWidth(textOverlay.offset.y)})`,
    scale: String(textOverlay.scale),
    transformOrigin: "center",
  };
}

export function editorTextOverlayTextStyle(
  textOverlay: PaintOverlay,
  renderSpec?: EditorRenderTextLayerSpec,
): CSSProperties {
  const effect = textOverlay.effect || "outline";
  return {
    color: textOverlay.color,
    fontFamily: renderSpec?.font.family || editorFontFamily(textOverlay.fontId),
    fontWeight: renderSpec?.font.resolvedWeight ?? resolveEditorFontFace(textOverlay.fontId, "text").resolvedWeight,
    fontSize: canvasWidth(72),
    lineHeight: 1.2,
    ...(effect === "none"
      ? { WebkitTextStroke: "0 transparent", filter: "none", textShadow: "none" }
      : effect === "outline"
        ? {
            WebkitTextStroke: ".14em rgba(0,0,0,.98)",
            filter: "drop-shadow(0 0 .025em rgba(0,0,0,.9))",
            paintOrder: "stroke fill",
            textShadow: "0 .035em .08em rgba(0,0,0,.46)",
          }
        : { WebkitTextStroke: "0 transparent", filter: "none", textShadow: "0 .09em .2em rgba(0,0,0,.88)" }),
  };
}

/** No browser re-wrapping: these are also the exact lines sent to the renderer. */
export function EditorTextOverlayLines({
  textOverlay,
  renderSpec,
}: {
  textOverlay: PaintOverlay;
  renderSpec?: EditorRenderTextLayerSpec;
}) {
  const lines = renderSpec?.lines || wrapEditorRenderText(textOverlay.text, textOverlay.width);
  return <>{lines.map((line, index) => (
    <span key={`${index}:${line}`} className="block whitespace-pre" style={{ minHeight: "1.2em" }}>{line}</span>
  ))}</>;
}

/** Safe inside a clickable template card: deliberately has no interactive child. */
export function EditorTextOverlayPaint({
  textOverlay,
  renderSpec,
  zIndex,
}: {
  textOverlay: PaintOverlay;
  renderSpec?: EditorRenderTextLayerSpec;
  zIndex?: number;
}) {
  return <div
    data-editor-text-overlay-id={textOverlay.id}
    className="pointer-events-none absolute rounded-[2.4cqw]"
    style={editorTextOverlayPositionStyle(textOverlay, zIndex)}
  >
    <div
      className="w-full whitespace-pre rounded-[2cqw] bg-transparent px-[2cqw] py-[1cqw] text-center font-extrabold"
      style={editorTextOverlayTextStyle(textOverlay, renderSpec)}
    >
      <EditorTextOverlayLines textOverlay={textOverlay} renderSpec={renderSpec} />
    </div>
  </div>;
}
