import type { CaptionRenderSpec } from "./caption-render-spec";

export type CaptionCompositionRect = { x: number; y: number; width: number; height: number };

// Older projects have no comment rectangle: keep their existing composition.
export function captionCompositionRect(
  spec: CaptionRenderSpec | null | undefined,
  name: string,
): CaptionCompositionRect | undefined {
  const rect = spec?.schemaVersion === 4 ? spec.layout?.[name] : undefined;
  if (!rect || typeof rect !== "object" || Array.isArray(rect)) return undefined;
  if (!["x", "y", "width", "height"].every((key) => (
    typeof rect[key] === "number" && Number.isFinite(rect[key])
  ))) return undefined;
  return rect as CaptionCompositionRect;
}
