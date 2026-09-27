import { TEMPLATE_CANVAS } from "@/lib/template-config";
import { EDITOR_TEXT_DEFAULT_WIDTH, type EditorTextOverlay } from "@/lib/editor-overlay-preview";
import { wrapEditorRenderText, type EditorRenderTextLayerSpec } from "@/lib/editor-render-spec";

export const EDITOR_TEXT_LINE_HEIGHT = 86;
export const EDITOR_TEXT_PADDING_X = 22;
export const EDITOR_TEXT_PADDING_Y = 11;
type TextGeometry = Omit<EditorTextOverlay, "startSeconds" | "endSeconds">;

/** Match the existing worker's centered text-layer boundary rule. */
export function editorTextOverlayOffset(
  overlay: TextGeometry,
  renderSpec?: EditorRenderTextLayerSpec,
) {
  const lines = renderSpec?.lines || wrapEditorRenderText(overlay.text, overlay.width);
  const width = Math.round((overlay.width ?? EDITOR_TEXT_DEFAULT_WIDTH) * overlay.scale);
  const height = Math.round(((renderSpec?.lineHeight ?? EDITOR_TEXT_LINE_HEIGHT)
    * lines.length + EDITOR_TEXT_PADDING_Y * 2) * overlay.scale);
  const centerX = TEMPLATE_CANVAS.width / 2 + overlay.offset.x;
  const centerY = TEMPLATE_CANVAS.height / 2 + overlay.offset.y;
  return {
    x: width > TEMPLATE_CANVAS.width || centerX - width / 2 < 0
      || centerX + width / 2 > TEMPLATE_CANVAS.width ? 0 : overlay.offset.x,
    y: height > TEMPLATE_CANVAS.height ? 0 : Math.min(
      TEMPLATE_CANVAS.height - height / 2,
      Math.max(height / 2, centerY),
    ) - TEMPLATE_CANVAS.height / 2,
  };
}

export function clampEditorTextOverlay(overlay: EditorTextOverlay): EditorTextOverlay {
  return { ...overlay, offset: editorTextOverlayOffset(overlay) };
}
