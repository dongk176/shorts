import { parseCaptionRenderSpec, type CaptionRenderSpec, type CaptionRenderSpecV4 } from "./caption-render-spec";

type CompiledSpec = Omit<CaptionRenderSpecV4, "editorSource">;

/** Older translated 5:4 presets stored a 140px padding box around 48px text.
 * Its lower 16px crossed the video edge even though all rendered glyphs fit.
 * Keep the authored center, cues, fonts and other layers; trim only symmetric
 * empty padding so the project's pinned worker can validate its composition.
 * This deliberately does not repair arbitrary user layouts or move subtitles.
 */
function trimTranslatedCaptionPadding(spec: CompiledSpec): CompiledSpec {
  if (spec.templateId !== "basic"
    || spec.translation?.policy !== "translated-basic-v1"
    || spec.style.maxLines !== 1 || spec.style.background) return spec;
  const video = spec.layout?.video;
  const caption = spec.layout?.caption;
  if (!video || typeof video !== "object" || Array.isArray(video)
    || !caption || typeof caption !== "object" || Array.isArray(caption)) return spec;
  // Match the original built-in 5:4 composition, never custom geometry.
  if (video.x !== 0 || video.y !== 528 || video.width !== 1080 || video.height !== 864
    || caption.x !== spec.safeArea.x || caption.y !== spec.safeArea.y
    || caption.width !== spec.safeArea.width || caption.height !== spec.safeArea.height
    || spec.safeArea.x < 0 || spec.safeArea.x + spec.safeArea.width > 1080) return spec;
  const centerY = spec.safeArea.y + spec.safeArea.height / 2;
  const height = 2 * Math.floor(Math.min(centerY - 528, 1392 - centerY));
  if (height >= spec.safeArea.height || height <= 0) return spec;
  const padding = 2 * (spec.style.outlineWidth + (spec.style.shadow ?? 0)) + 32;
  if (spec.style.fontSize + padding > height || spec.cues.some((cue) => (
    cue.centerY !== centerY || cue.lines?.length !== 1
    || cue.fontSize === undefined
    || cue.fontSize + padding > height
  ))) return spec;
  const rect = { ...spec.safeArea, y: centerY - height / 2, height };
  return { ...spec, safeArea: rect, layout: { ...spec.layout, caption: { ...rect } } };
}

/** V4 cues have absolute positions. Legacy composition metadata must fit the
 * video even for the built-in 5:4 preset whose caption extends into the footer.
 * Intersect only that known metadata box; never change actual caption geometry.
 */
function normalizeLegacyCaptionMetadata(spec: CompiledSpec): CompiledSpec {
  const video = spec.layout?.video;
  const caption = spec.layout?.caption;
  if (!video || typeof video !== "object" || Array.isArray(video)
    || !caption || typeof caption !== "object" || Array.isArray(caption)
    || video.x !== 0 || video.y !== 528 || video.width !== 1080 || video.height !== 864
    || spec.cues.some((cue) => !Number.isFinite(cue.centerX) || !Number.isFinite(cue.centerY))) return spec;
  const legacyDefaultBox = caption.x === 90 && caption.y === 1340
    && caption.width === 900 && caption.height === 140;
  // Older lower-position highlight captions used a different fixed box. V4
  // renders from safeArea and absolute cue positions, not this composition box.
  // Preserve those coordinates even when captions are currently switched off.
  const legacyHighlightBox = spec.templateId === "highlight"
    && spec.layoutMode === "absolute-word-positions-v1"
    && caption.x === 120 && caption.y === 1333
    && caption.width === 840 && caption.height === 140
    && caption.x === spec.safeArea.x && caption.y === spec.safeArea.y
    && caption.width === spec.safeArea.width && caption.height === spec.safeArea.height;
  if (!legacyDefaultBox && !legacyHighlightBox) return spec;
  return { ...spec, layout: { ...spec.layout, caption: {
    ...caption, height: legacyDefaultBox ? 52 : 59,
  } } };
}

export function normalizeStoredCaptionComposition(value: unknown): CaptionRenderSpec | null {
  const parsed = parseCaptionRenderSpec(value);
  if (!parsed || parsed.schemaVersion !== 4) return null;
  const normalized = normalizeLegacyCaptionMetadata(trimTranslatedCaptionPadding(parsed));
  const source = parsed.editorSource;
  const normalizedSource = source ? normalizeLegacyCaptionMetadata(trimTranslatedCaptionPadding(source.spec)) : null;
  if (normalized === parsed && (!source || normalizedSource === source.spec)) return null;
  // Parsing validates the contract but strips auxiliary word provenance. Patch
  // only the two rectangles on the original JSON so all other metadata survives.
  const preserved = structuredClone(value) as CaptionRenderSpecV4;
  if (normalized !== parsed) {
    preserved.safeArea = normalized.safeArea;
    preserved.layout = { ...preserved.layout, caption: normalized.layout!.caption };
  }
  if (source && normalizedSource !== source.spec && preserved.editorSource) {
    preserved.editorSource.spec.safeArea = normalizedSource!.safeArea;
    preserved.editorSource.spec.layout = {
      ...preserved.editorSource.spec.layout, caption: normalizedSource!.layout!.caption,
    };
  }
  return preserved;
}
