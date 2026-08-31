import {
  MAX_TEMPLATE_TEXT_OVERLAYS,
  type TemplateConfig,
  type TemplateSnapshot,
} from "@/lib/template-config";
import {
  normalizeEditorOverlayLayerOrder,
  type EditorOverlayLayoutSnapshot,
  type EditorOverlayOrderItem,
  type EditorTextOverlay,
} from "@/lib/editor-overlay-preview";

const TEMPLATE_TEXT_ORIGIN = /^tpl:[0-9a-f-]{36}:[0-9a-f-]{36}$/i;

export function templateHasCustomDesign(config: TemplateConfig): boolean {
  return config.background.kind === "uploaded_image"
    || config.textOverlays !== undefined
    || config.layerOrder !== undefined;
}

/** Detect new persisted fields before admitting any legacy render endpoint. */
export function storedShortHasCustomDesign(input: { templateSnapshot?: unknown; editorDocument?: unknown }): boolean {
  const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const document = object(input.editorDocument);
  const configs = [object(input.templateSnapshot).config, object(object(document.template).snapshot).config];
  if (configs.some((value) => {
    const config = object(value);
    return object(config.background).kind === "uploaded_image"
      || config.textOverlays !== undefined
      || config.layerOrder !== undefined;
  })) return true;
  const overlays = object(document.overlays);
  return object(overlays.background).kind === "uploaded_image"
    || (Array.isArray(overlays.textOverlays) && overlays.textOverlays.some((item) => (
      typeof object(item).id === "string" && isTemplateOriginText(String(object(item).id))
    )));
}

export function templateDesignFingerprint(config: TemplateConfig): string {
  return JSON.stringify({
    background: config.background.kind === "uploaded_image" ? config.background : null,
    textOverlays: config.textOverlays ?? null,
    layerOrder: config.layerOrder ?? null,
  });
}

export function isTemplateOriginText(id: string): boolean {
  return TEMPLATE_TEXT_ORIGIN.test(id);
}

export function templateTextOverlaysForVideo(
  template: Pick<TemplateSnapshot, "id" | "config"> | null,
  durationSeconds: number,
): EditorTextOverlay[] {
  if (!template) return [];
  return (template.config.textOverlays ?? []).map((overlay) => ({
    ...overlay,
    id: `tpl:${template.id}:${overlay.id}`,
    offset: { ...overlay.offset },
    startSeconds: 0,
    endSeconds: Math.max(0.3, durationSeconds),
  }));
}

/** Called on explicit template changes, never over a restored document/draft. */
export function replaceTemplateTextOverlays(
  layout: EditorOverlayLayoutSnapshot,
  template: Pick<TemplateSnapshot, "id" | "config"> | null,
  durationSeconds: number,
): EditorOverlayLayoutSnapshot {
  const manual = layout.textOverlays.filter((overlay) => !isTemplateOriginText(overlay.id));
  const inherited = templateTextOverlaysForVideo(template, durationSeconds);
  if (manual.length + inherited.length > MAX_TEMPLATE_TEXT_OVERLAYS) {
    throw new Error(`직접 추가한 텍스트와 템플릿 텍스트는 합쳐서 ${MAX_TEMPLATE_TEXT_OVERLAYS}개까지 사용할 수 있습니다.`);
  }
  const manualIds = new Set(manual.map((overlay) => `text:${overlay.id}`));
  const configuredOrder = template?.config.layerOrder;
  let order: EditorOverlayOrderItem[] = configuredOrder
    ? configuredOrder.map((item) => item.startsWith("text:")
      ? `text:tpl:${template.id}:${item.slice(5)}` as const
      : item)
    : layout.layerOrder.filter((item) => !item.startsWith("text:"));
  if (!configuredOrder) {
    order = [
      ...order.filter((item) => item !== "channel"),
      ...inherited.map((overlay) => `text:${overlay.id}` as const),
      "channel",
    ];
  }
  // Preserve each manual layer's relative base-layer placement where possible.
  for (let index = 0; index < layout.layerOrder.length; index += 1) {
    const item = layout.layerOrder[index];
    if (!manualIds.has(item)) continue;
    const previous = layout.layerOrder.slice(0, index).reverse()
      .find((candidate) => order.includes(candidate));
    order.splice(previous ? order.indexOf(previous) + 1 : 0, 0, item);
  }
  for (const overlay of manual) {
    const item = `text:${overlay.id}` as const;
    if (!order.includes(item)) order.splice(Math.max(0, order.indexOf("channel")), 0, item);
  }
  return {
    ...layout,
    textOverlays: [...manual, ...inherited],
    layerOrder: normalizeEditorOverlayLayerOrder(order),
  };
}

export const CUSTOM_TEMPLATE_VERSION_CONFLICT = "CUSTOM_TEMPLATE_VERSION_CONFLICT";

export function templateVersionRequiresConfirmation(
  config: TemplateConfig,
  storedVersion: number,
  requestedVersion?: number | null,
): boolean {
  return requestedVersion == null
    ? templateHasCustomDesign(config)
    : requestedVersion !== storedVersion;
}
