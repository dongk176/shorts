import type { EditorDocumentSnapshot } from "@/lib/editor-document-snapshot";
import type {
  EditorOverlayLayoutSnapshot,
  EditorOverlayOrderItem,
} from "@/lib/editor-overlay-preview";
import {
  EDITOR_RENDER_SPEC_V4_VERSION,
  type EditorRenderSpec,
  type EditorRenderSpecV4,
} from "@/lib/editor-render-spec";

export type EditorInitialRenderSpecLayerFingerprints = {
  title: string;
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
  return {
    ...compiled,
    title: current.title === baseline.title
      && initialRenderTitleMatchesDocument(document, initialRenderSpec)
      ? structuredClone(initialRenderSpec.title)
      : compiled.title,
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
