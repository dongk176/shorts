import type { CSSProperties } from "react";
import { backgroundAssetImageUrl } from "@/lib/background-assets-contract";
import {
  createEditorTextOverlay,
  editorOverlayZIndex,
  moveEditorOverlayOrderItem,
  normalizeEditorOverlayLayerOrder,
  type EditorOverlayOrderItem,
  type EditorTextOverlay,
} from "@/lib/editor-overlay-preview";
import { resolveEditorFontFace } from "@/lib/editor-fonts";
import {
  wrapEditorRenderText,
  type EditorRenderTextLayerSpec,
} from "@/lib/editor-render-spec";
import {
  stockBackgrounds,
  MAX_TEMPLATE_TEXT_OVERLAYS,
  type TemplateConfig,
  type TemplateTextOverlay,
} from "@/lib/template-config";

export const TEMPLATE_TEXT_OVERLAY_LIMIT = MAX_TEMPLATE_TEXT_OVERLAYS;
export { backgroundAssetImageUrl };

/** The same saved image and center-cover placement are used on every canvas. */
export function templateBackgroundStyle(
  background: TemplateConfig["background"],
): CSSProperties {
  if (background.kind === "color") return { backgroundColor: background.color };
  const src = background.kind === "uploaded_image"
    ? backgroundAssetImageUrl(background.assetId)
    : stockBackgrounds.find((asset) => asset.id === background.assetId)?.src || "";
  return {
    backgroundImage: `url("${src}")`,
    backgroundPosition: "center",
    backgroundSize: "cover",
  };
}

export function hasTemplateDesignLayerOrder(config: TemplateConfig): boolean {
  return config.layerOrder !== undefined || (config.textOverlays?.length || 0) > 0;
}

export function templateDesignLayerOrder(config: TemplateConfig): EditorOverlayOrderItem[] {
  const textIds = (config.textOverlays || []).map((text): EditorOverlayOrderItem => `text:${text.id}`);
  const expected: EditorOverlayOrderItem[] = ["video", "title", "comment", ...textIds, "channel"];
  const order = (config.layerOrder || expected).filter((item, index, items) => (
    expected.includes(item) && items.indexOf(item) === index
  ));
  return normalizeEditorOverlayLayerOrder([
    ...order,
    ...expected.filter((item) => !order.includes(item)),
  ]);
}

export function templateDesignLayerZIndex(
  config: TemplateConfig,
  item: EditorOverlayOrderItem,
): number | undefined {
  if (!hasTemplateDesignLayerOrder(config)) return undefined;
  return editorOverlayZIndex(templateDesignLayerOrder(config), item, true);
}

export function templateTextEditorValue(overlay: TemplateTextOverlay): EditorTextOverlay {
  return { ...overlay, startSeconds: 0, endSeconds: 1 };
}

/** Preview timing is transient; no time field is ever written into a template. */
export function templateTextRenderSpec(overlay: TemplateTextOverlay): EditorRenderTextLayerSpec {
  return {
    id: overlay.id,
    lines: wrapEditorRenderText(overlay.text, overlay.width),
    centerX: 540 + overlay.offset.x,
    centerY: 960 + overlay.offset.y,
    width: overlay.width,
    fontSize: 72,
    lineHeight: 86,
    scale: overlay.scale,
    color: overlay.color,
    effect: overlay.effect,
    outlineWidth: overlay.effect === "outline" ? 10 : 0,
    shadowBlur: overlay.effect === "shadow" ? 13 : 0,
    startFrame: 0,
    endFrame: 30,
    font: resolveEditorFontFace(overlay.fontId, "text"),
  };
}

export function addTemplateTextOverlay(config: TemplateConfig, id: string): TemplateConfig {
  if ((config.textOverlays?.length || 0) >= TEMPLATE_TEXT_OVERLAY_LIMIT) {
    throw new Error("텍스트는 최대 20개까지 추가할 수 있습니다.");
  }
  const created = createEditorTextOverlay(id, 1);
  const text: TemplateTextOverlay = {
    id: created.id,
    text: created.text,
    fontId: created.fontId,
    color: created.color,
    effect: created.effect,
    offset: created.offset,
    width: created.width,
    scale: created.scale,
  };
  const next = { ...config, textOverlays: [...(config.textOverlays || []), text] };
  return { ...next, layerOrder: templateDesignLayerOrder(next) };
}

export function removeTemplateTextOverlay(config: TemplateConfig, id: string): TemplateConfig {
  if (!config.textOverlays?.some((text) => text.id === id)) return config;
  return {
    ...config,
    textOverlays: config.textOverlays.filter((text) => text.id !== id),
    layerOrder: templateDesignLayerOrder(config).filter((item) => item !== `text:${id}`),
  };
}

export function moveTemplateTextLayer(
  config: TemplateConfig,
  id: string,
  direction: "forward" | "backward",
  commentLayerEnabled: boolean,
): TemplateConfig {
  const order = templateDesignLayerOrder(config);
  const visibleOrder = order.filter((item) => (
    item.startsWith("text:") || item === "video"
      || (item === "comment" ? commentLayerEnabled && config.comment.visible : config[item as "title" | "channel"].visible)
  ));
  const layerOrder = moveEditorOverlayOrderItem(order, `text:${id}`, direction, visibleOrder, true);
  return { ...config, layerOrder };
}
