import type { EditorDocumentSnapshot } from "@/lib/editor-document-snapshot";
import type {
  EditorOverlayLayoutSnapshot,
  EditorOverlayOrderItem,
} from "@/lib/editor-overlay-preview";
import {
  EDITOR_RENDER_SPEC_V4_VERSION,
  quantizeEditorRenderPx,
  type EditorRenderSpec,
  type EditorRenderTitleSpecV4,
  type EditorRenderSpecV4,
} from "@/lib/editor-render-spec";

export type EditorInitialRenderSpecLayerFingerprints = {
  title: string;
  titleGeometry: string;
  titleFontId: string;
  titleOffset: { x: number; y: number };
  channel: string;
};

export function seedEditorOverlayLayoutFromInitialRenderSpec(
  layout: EditorOverlayLayoutSnapshot,
  initialRenderSpec: EditorRenderSpec | null | undefined,
): EditorOverlayLayoutSnapshot {
  if (initialRenderSpec?.version !== EDITOR_RENDER_SPEC_V4_VERSION) {
    return layout;
  }
  return {
    ...layout,
    offsets: {
      ...layout.offsets,
      video: {
        x: initialRenderSpec.video.offsetX,
        y: initialRenderSpec.video.offsetY,
      },
      channel: {
        x: initialRenderSpec.channel.offsetX,
        y: initialRenderSpec.channel.offsetY,
      },
    },
    scales: {
      ...layout.scales,
      video: initialRenderSpec.video.scale,
      channel: initialRenderSpec.channel.scale,
    },
    fonts: {
      ...layout.fonts,
      title: initialRenderSpec.title.font.fontId,
      channel: initialRenderSpec.channel.font.fontId,
    },
    visible: {
      ...layout.visible,
      title: initialRenderSpec.title.visible,
      channel: initialRenderSpec.channel.visible,
    },
    layerOrder: initialRenderSpec.layerOrder
      .map((item) => item as EditorOverlayOrderItem),
  };
}

export function seedEditorDocumentInitialRenderSpec(
  document: EditorDocumentSnapshot,
  initialRenderSpec: EditorRenderSpec | null | undefined,
): EditorDocumentSnapshot {
  if (document.version !== 3 || !initialRenderSpec) return document;
  return {
    ...document,
    renderSpec: structuredClone(initialRenderSpec),
  };
}

export function editorDocumentSemanticFingerprint(
  document: EditorDocumentSnapshot,
) {
  if (document.version !== 3) return JSON.stringify(document);
  const { renderSpec, ...semanticDocument } = document;
  void renderSpec;
  return JSON.stringify(semanticDocument);
}

export function editorInitialRenderSpecLayerFingerprints(
  document: EditorDocumentSnapshot,
): EditorInitialRenderSpecLayerFingerprints | null {
  if (document.version !== 3) return null;
  const titleBackgroundColors = Array.from(
    { length: Array.from(document.title.text).length },
    () => null as string | null,
  );
  document.title.textStyles.forEach((style) => {
    for (
      let index = Math.max(0, style.start);
      index < Math.min(titleBackgroundColors.length, style.end);
      index += 1
    ) {
      titleBackgroundColors[index] = style.backgroundColor || null;
    }
  });
  return {
    title: JSON.stringify({
      template: document.template,
      title: document.title,
      videoAspectRatio: document.video.aspectRatio,
      offset: document.overlays.offsets.title,
      scale: document.overlays.scales.title,
      font: document.overlays.fonts.title,
      visible: document.overlays.visible.title,
    }),
    // Foreground color and x/y position do not change title geometry. Keeping
    // a separate fingerprint lets older saved v4 documents retain the exact
    // title they currently show while those two properties are edited.
    titleGeometry: JSON.stringify({
      template: document.template,
      title: {
        text: document.title.text,
        fontScale: document.title.fontScale,
        backgroundColors: titleBackgroundColors,
      },
      videoAspectRatio: document.video.aspectRatio,
      scale: document.overlays.scales.title,
      font: document.overlays.fonts.title,
    }),
    titleFontId: document.overlays.fonts.title,
    titleOffset: { ...document.overlays.offsets.title },
    channel: JSON.stringify({
      template: document.template,
      channel: document.channel,
      offset: document.overlays.offsets.channel,
      scale: document.overlays.scales.channel,
      font: document.overlays.fonts.channel,
      visible: document.overlays.visible.channel,
    }),
  };
}

function initialRenderTitleMatchesBaseline(
  baseline: EditorInitialRenderSpecLayerFingerprints,
  initialRenderSpec: EditorRenderSpecV4,
) {
  return !Object.is(initialRenderSpec.title.offsetY, -0)
    && initialRenderSpec.title.offsetY === baseline.titleOffset.y
    && initialRenderSpec.title.font.fontId === baseline.titleFontId
    && initialRenderSpec.title.font.requestedWeight === 700;
}

function shiftedInitialTitle(
  initial: EditorRenderTitleSpecV4,
  compiled: EditorRenderTitleSpecV4,
  baselineOffset: { x: number; y: number },
  currentOffset: { x: number; y: number },
): EditorRenderTitleSpecV4 | null {
  if (initial.lineBoxes.length === 0) return null;
  const left = Math.min(...initial.lineBoxes.map(
    (line) => line.centerX - line.width / 2,
  ));
  const right = Math.max(...initial.lineBoxes.map(
    (line) => line.centerX + line.width / 2,
  ));
  const top = Math.min(...initial.lineBoxes.map(
    (line) => line.centerY - line.height / 2,
  ));
  const bottom = Math.max(...initial.lineBoxes.map(
    (line) => line.centerY + line.height / 2,
  ));
  const requestedDeltaX = currentOffset.x - baselineOffset.x;
  const requestedDeltaY = currentOffset.y - baselineOffset.y;
  const deltaX = quantizeEditorRenderPx(Math.max(
    initial.clamp.minX - left,
    Math.min(initial.clamp.maxX - right, requestedDeltaX),
  ));
  const deltaY = quantizeEditorRenderPx(Math.max(
    initial.clamp.minY - top,
    Math.min(initial.clamp.maxY - bottom, requestedDeltaY),
  ));
  return {
    ...structuredClone(initial),
    visible: compiled.visible,
    centerX: quantizeEditorRenderPx(initial.centerX + deltaX),
    centerY: quantizeEditorRenderPx(initial.centerY + deltaY),
    offsetY: quantizeEditorRenderPx(currentOffset.y),
    lineBoxes: initial.lineBoxes.map((line) => ({
      ...line,
      centerX: quantizeEditorRenderPx(line.centerX + deltaX),
      centerY: quantizeEditorRenderPx(line.centerY + deltaY),
      baselineY: quantizeEditorRenderPx(line.baselineY + deltaY),
      backgroundRuns: line.backgroundRuns.map((run) => ({
        ...run,
        ...(typeof run.x === "number"
          ? { x: quantizeEditorRenderPx(run.x + deltaX) }
          : {}),
        ...(typeof run.y === "number"
          ? { y: quantizeEditorRenderPx(run.y + deltaY) }
          : {}),
      })),
    })),
  };
}

function initialRenderTitleMatchesDocument(
  document: EditorDocumentSnapshot,
  initialRenderSpec: EditorRenderSpecV4,
) {
  return !Object.is(initialRenderSpec.title.offsetY, -0)
    && initialRenderSpec.title.offsetY === document.overlays.offsets.title.y
    && initialRenderSpec.title.font.fontId === document.overlays.fonts.title
    && initialRenderSpec.title.font.requestedWeight === 700;
}

export function preserveUnchangedInitialRenderSpecLayers(
  compiled: EditorRenderSpecV4,
  document: EditorDocumentSnapshot,
  initialRenderSpec: EditorRenderSpec | null | undefined,
  baseline: EditorInitialRenderSpecLayerFingerprints | null,
): EditorRenderSpecV4 {
  if (
    document.version !== 3
    || initialRenderSpec?.version !== EDITOR_RENDER_SPEC_V4_VERSION
    || !baseline
  ) {
    return compiled;
  }
  const current = editorInitialRenderSpecLayerFingerprints(document);
  if (!current) return compiled;
  const unchangedTitle = current.title === baseline.title
    && initialRenderTitleMatchesDocument(document, initialRenderSpec);
  const positionOrForegroundColorOnly = current.titleGeometry
    === baseline.titleGeometry
    && initialRenderTitleMatchesBaseline(baseline, initialRenderSpec);
  const preservedTitle = positionOrForegroundColorOnly
    ? shiftedInitialTitle(
        initialRenderSpec.title,
        compiled.title,
        baseline.titleOffset,
        current.titleOffset,
      )
    : null;
  return {
    ...compiled,
    title: unchangedTitle
      ? structuredClone(initialRenderSpec.title)
      : preservedTitle || compiled.title,
    channel: current.channel === baseline.channel
      ? structuredClone(initialRenderSpec.channel)
      : compiled.channel,
  };
}

export function shouldPreserveInitialEditorRenderSpec(
  document: EditorDocumentSnapshot,
  initialRenderSpec: EditorRenderSpec | null | undefined,
  baselineFingerprint: string | null,
) {
  return Boolean(
    initialRenderSpec?.version === EDITOR_RENDER_SPEC_V4_VERSION
    && document.version === 3
    && document.renderSpec.version === EDITOR_RENDER_SPEC_V4_VERSION
    && initialRenderTitleMatchesDocument(document, initialRenderSpec)
    && JSON.stringify(document.renderSpec) === JSON.stringify(initialRenderSpec)
    && baselineFingerprint !== null
    && baselineFingerprint === editorDocumentSemanticFingerprint(document),
  );
}
