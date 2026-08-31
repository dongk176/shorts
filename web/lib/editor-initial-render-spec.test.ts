import { describe, expect, it } from "vitest";
import {
  canonicalizeEditorDocumentV4TitleOffset,
  createEditorDocumentSnapshot,
  createEditorDocumentSnapshotV3,
} from "./editor-document-snapshot";
import {
  editorDocumentSemanticFingerprint,
  editorInitialRenderSpecLayerFingerprints,
  preserveUnchangedInitialRenderSpecLayers,
  seedEditorDocumentInitialRenderSpec,
  seedEditorOverlayLayoutFromInitialRenderSpec,
  shouldPreserveInitialEditorRenderSpec,
} from "./editor-initial-render-spec";
import { resolveEditorFontFaceV4 } from "./editor-fonts";
import { createInitialEditorOverlayLayout } from "./editor-overlay-preview";
import type { EditorRenderSpecV4 } from "./editor-render-spec";

function input() {
  return {
    sourceShortId: "d164fb8d-d6e1-4232-8463-9115cdf7e561",
    baseRenderVersion: 1,
    template: {
      id: "dark-red" as const,
      customTemplateId: null,
      presetVersion: 3,
      snapshot: { presetVersion: 3 },
    },
    title: { text: "최초 제목", textStyles: [], fontScale: 1 },
    channel: {
      displayName: "채널",
      thumbnailUrl: null,
      thumbnailAssetKey: null,
    },
    comments: [],
    subtitles: { enabled: false, segments: [] },
    overlays: createInitialEditorOverlayLayout(),
    video: {
      clips: [{ id: "clip-1", sourceStartSeconds: 0, sourceEndSeconds: 3 }],
      aspectRatio: "16:9" as const,
      timelineStartSeconds: 0,
      timelineEndSeconds: 3,
      selectionStartSeconds: 0,
      selectionEndSeconds: 3,
    },
  };
}

function v4Spec(
  document: ReturnType<typeof createEditorDocumentSnapshotV3>,
): EditorRenderSpecV4 {
  const font = resolveEditorFontFaceV4("pretendard", "title");
  return {
    version: 4,
    canvas: document.renderSpec.canvas,
    fps: document.renderSpec.fps,
    layerOrder: document.renderSpec.layerOrder,
    comments: document.renderSpec.comments,
    video: document.renderSpec.video,
    title: {
      visible: false,
      lines: [document.title.text],
      centerX: 540,
      centerY: 180,
      offsetY: 0,
      fontSize: 84,
      scale: 1,
      lineGap: 16,
      linePaddingX: 20,
      linePaddingY: 10,
      clamp: { minX: 0, maxX: 1080, minY: 0, maxY: 1920 },
      lineBoxes: [],
      font,
    },
    channel: {
      ...document.renderSpec.channel,
      visible: false,
      font,
    },
    textOverlays: [],
  };
}

describe("initial editor render specification", () => {
  it("seeds a v3 document with an exact independent render-spec clone", () => {
    const document = createEditorDocumentSnapshotV3(input());
    const initialRenderSpec = structuredClone(document.renderSpec);
    initialRenderSpec.video.offsetY = 42;

    const seeded = seedEditorDocumentInitialRenderSpec(
      document,
      initialRenderSpec,
    );
    expect(seeded).not.toBe(document);
    expect(seeded.version).toBe(3);
    if (seeded.version !== 3) throw new Error("expected v3 document");
    expect(seeded.renderSpec).toEqual(initialRenderSpec);
    expect(seeded.renderSpec).not.toBe(initialRenderSpec);

    seeded.renderSpec.video.offsetY = 84;
    expect(initialRenderSpec.video.offsetY).toBe(42);
  });

  it("keeps v2 documents unchanged and ignores render-only fingerprint changes", () => {
    const v2 = createEditorDocumentSnapshot(input());
    expect(seedEditorDocumentInitialRenderSpec(v2, null)).toBe(v2);

    const left = createEditorDocumentSnapshotV3(input());
    const right = structuredClone(left);
    right.renderSpec.video.offsetY = 99;
    expect(editorDocumentSemanticFingerprint(left)).toBe(
      editorDocumentSemanticFingerprint(right),
    );
    right.title.text = "의미 변경";
    expect(editorDocumentSemanticFingerprint(left)).not.toBe(
      editorDocumentSemanticFingerprint(right),
    );
  });

  it("preserves only an exact v4 spec with an unchanged finalized document", () => {
    const legacy = createEditorDocumentSnapshotV3(input());
    const v4 = {
      ...legacy.renderSpec,
      version: 4 as const,
    } as never;
    const document = seedEditorDocumentInitialRenderSpec(legacy, v4);
    const baseline = editorDocumentSemanticFingerprint(document);
    expect(shouldPreserveInitialEditorRenderSpec(
      document,
      v4,
      baseline,
    )).toBe(true);

    const edited = structuredClone(document);
    edited.title.text = "수정된 제목";
    expect(shouldPreserveInitialEditorRenderSpec(
      edited,
      v4,
      baseline,
    )).toBe(false);
    expect(shouldPreserveInitialEditorRenderSpec(
      legacy,
      legacy.renderSpec,
      editorDocumentSemanticFingerprint(legacy),
    )).toBe(false);
  });

  it.each(["offset", "font", "weight", "negative zero"])(
    "does not reuse an initial title with mismatched %s despite an unchanged baseline",
    (drift) => {
      const source = createEditorDocumentSnapshotV3(input());
      const initial = v4Spec(source);
      if (drift === "offset") initial.title.offsetY = 12.346;
      if (drift === "negative zero") {
        source.overlays.offsets.title.y = -0.0004;
        initial.title.offsetY = -0;
      }
      if (drift === "font") {
        initial.title.font = resolveEditorFontFaceV4("jua", "title");
      }
      if (drift === "weight") initial.title.font.requestedWeight = 800;
      const document = canonicalizeEditorDocumentV4TitleOffset(
        seedEditorDocumentInitialRenderSpec(source, initial),
      );
      expect(shouldPreserveInitialEditorRenderSpec(
        document,
        initial,
        editorDocumentSemanticFingerprint(document),
      )).toBe(false);

      const compiled = v4Spec(source);
      compiled.title.fontSize = 52;
      const merged = preserveUnchangedInitialRenderSpecLayers(
        compiled,
        document,
        initial,
        editorInitialRenderSpecLayerFingerprints(document),
      );
      expect(merged.title).toEqual(compiled.title);
      expect(merged.channel).toEqual(initial.channel);
    },
  );

  it("preserves exact initial geometry after normalizing the matching title offset", () => {
    const source = createEditorDocumentSnapshotV3(input());
    source.overlays.offsets.title.y = 12.34567;
    const initial = v4Spec(source);
    initial.title.offsetY = 12.346;
    const document = canonicalizeEditorDocumentV4TitleOffset(
      seedEditorDocumentInitialRenderSpec(source, initial),
    );

    expect(shouldPreserveInitialEditorRenderSpec(
      document,
      initial,
      editorDocumentSemanticFingerprint(document),
    )).toBe(true);
    const compiled = structuredClone(initial);
    compiled.title.centerY += 1;
    const merged = preserveUnchangedInitialRenderSpecLayers(
      compiled,
      document,
      initial,
      editorInitialRenderSpecLayerFingerprints(document),
    );
    expect(merged.title).toEqual(initial.title);
    expect(merged.title).not.toBe(initial.title);
    expect(source.overlays.offsets.title.y).toBe(12.34567);
  });

  it("seeds hidden initial layers and their exact font identities", () => {
    const document = createEditorDocumentSnapshotV3(input());
    const initial = v4Spec(document);
    initial.video = { offsetX: 12, offsetY: -18, scale: 1.15 };
    initial.channel.offsetX = -28;
    initial.channel.offsetY = 31;
    initial.channel.scale = 0.9;
    initial.layerOrder = ["channel", "video", "title", "comment"];
    const seeded = seedEditorOverlayLayoutFromInitialRenderSpec(
      createInitialEditorOverlayLayout(),
      initial,
    );

    expect(seeded.visible.title).toBe(false);
    expect(seeded.visible.channel).toBe(false);
    expect(seeded.fonts.title).toBe(initial.title.font.fontId);
    expect(seeded.fonts.channel).toBe(initial.channel.font.fontId);
    expect(seeded.offsets.video).toEqual({ x: 12, y: -18 });
    expect(seeded.offsets.title).toEqual({ x: 0, y: 0 });
    expect(seeded.offsets.channel).toEqual({ x: -28, y: 31 });
    expect(seeded.scales).toEqual({ video: 1.15, title: 1, channel: 0.9 });
    expect(seeded.layerOrder).toEqual(initial.layerOrder);
  });

  it("keeps stored title geometry when only the channel changes", () => {
    const baselineDocument = createEditorDocumentSnapshotV3(input());
    baselineDocument.overlays.visible.title = false;
    baselineDocument.overlays.visible.channel = false;
    const initial = v4Spec(baselineDocument);
    const baseline = editorInitialRenderSpecLayerFingerprints(baselineDocument);
    const edited = structuredClone(baselineDocument);
    edited.channel.displayName = "수정한 채널";
    const compiled = structuredClone(initial);
    compiled.title.fontSize = 52;
    compiled.channel.offsetY = 45;

    const merged = preserveUnchangedInitialRenderSpecLayers(
      compiled,
      edited,
      initial,
      baseline,
    );

    expect(merged.title).toEqual(initial.title);
    expect(merged.channel).toEqual(compiled.channel);
  });

  it("recompiles stored title geometry after an actual title edit", () => {
    const baselineDocument = createEditorDocumentSnapshotV3(input());
    baselineDocument.overlays.visible.title = false;
    baselineDocument.overlays.visible.channel = false;
    const initial = v4Spec(baselineDocument);
    const baseline = editorInitialRenderSpecLayerFingerprints(baselineDocument);
    const edited = structuredClone(baselineDocument);
    edited.title.text = "실제로 바꾼 제목";
    const compiled = structuredClone(initial);
    compiled.title.lines = [edited.title.text];
    compiled.title.fontSize = 52;

    const merged = preserveUnchangedInitialRenderSpecLayers(
      compiled,
      edited,
      initial,
      baseline,
    );

    expect(merged.title).toEqual(compiled.title);
    expect(merged.channel).toEqual(initial.channel);
  });
});
