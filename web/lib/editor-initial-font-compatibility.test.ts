import { describe, expect, it } from "vitest";
import { contentTextFont, contentTitleFont, hasUnsupportedCjkFont } from "./content-language";
import { createEditorDocumentSnapshotV3 } from "./editor-document-snapshot";
import { editorDraftDocumentSnapshotSchema, editorDocumentSnapshotSchema } from "./editor-document-contract";
import { createEditorDraftRecord, parseEditorDraftRecord } from "./editor-draft-store";
import { createInitialEditorOverlayLayout } from "./editor-overlay-preview";
import { resolveEditorFontFaceV4 } from "./editor-fonts";
import { compileEditorRenderTitleSpecV4, type EditorRenderSpecV4 } from "./editor-render-spec";
import { editorDocumentSemanticFingerprint, editorInitialRenderSpecLayerFingerprints, initialEditorRenderSpecMatchesDocument, preserveUnchangedInitialRenderSpecLayers, seedEditorDocumentInitialRenderSpec, shouldPreserveInitialEditorRenderSpec } from "./editor-initial-render-spec";

function fixture(channel: string, title = "教科書版の人狼ゲーム？\n数学の単元を当てろ！") {
  const overlays = createInitialEditorOverlayLayout();
  overlays.fonts.title = "noto-sans-jp";
  const doc = createEditorDocumentSnapshotV3({
    sourceShortId: "5bce826b-1cb6-487f-9a01-8b4d960bff12", baseRenderVersion: 1,
    template: { id: "dark-red", customTemplateId: null, presetVersion: 3, snapshot: { presetVersion: 3 } },
    title: { text: title, textStyles: [], fontScale: 1 },
    channel: { displayName: channel, thumbnailUrl: null, thumbnailAssetKey: null },
    comments: [], subtitles: { enabled: false, segments: [] }, overlays,
    video: { clips: [{id: "clip-1", sourceStartSeconds: 0, sourceEndSeconds: 3}], aspectRatio: "16:9", timelineStartSeconds: 0, timelineEndSeconds: 3, selectionStartSeconds: 0, selectionEndSeconds: 3 },
  });
  const initial: EditorRenderSpecV4 = {
    canvas: doc.renderSpec.canvas, fps: doc.renderSpec.fps,
    layerOrder: doc.renderSpec.layerOrder, comments: doc.renderSpec.comments,
    video: doc.renderSpec.video, version: 4,
    title: compileEditorRenderTitleSpecV4(doc, (text, size) => ({width: Array.from(text).length * size, actualBoundingBoxAscent: size * .8, actualBoundingBoxDescent: size * .2})),
    channel: {...doc.renderSpec.channel, visible: doc.overlays.visible.channel, font: resolveEditorFontFaceV4("pretendard", "channel")}, textOverlays: [],
  };
  return { doc, initial };
}

describe("initial worker fonts versus editor content fonts", () => {
  it.each(["noto-sans-kr", "noto-serif-kr"] as const)("retains a Japanese title changed to %s through draft restore and output compilation", (fontId) => {
    const { doc, initial } = fixture("English Channel", "教科書版の人狼ゲーム？");
    const baseline = editorInitialRenderSpecLayerFingerprints(doc);
    doc.overlays.fonts.title = contentTitleFont(doc.title.text, fontId, true);
    expect(doc.overlays.fonts.title).toBe(fontId);
    const normalized = createEditorDocumentSnapshotV3(doc);
    const seeded = seedEditorDocumentInitialRenderSpec(normalized, initial);
    expect(initialEditorRenderSpecMatchesDocument(normalized, initial)).toBe(false);
    const restored = parseEditorDraftRecord(createEditorDraftRecord(seeded));
    expect(restored).not.toBeNull();
    expect(restored?.document.overlays.fonts.title).toBe(fontId);
    expect(hasUnsupportedCjkFont(seeded)).toBe(false);
    const compiled = { ...initial,
      title: compileEditorRenderTitleSpecV4(normalized, (text, size) => ({width: Array.from(text).length * size, actualBoundingBoxAscent: size * .8, actualBoundingBoxDescent: size * .2})),
    };
    const output = preserveUnchangedInitialRenderSpecLayers(compiled, normalized, initial, baseline);
    expect(output.title.font.fontId).toBe(fontId);
    editorDocumentSnapshotSchema.parse({ ...normalized, renderSpec: output });
  });
  it.each(["須貝駿貴", "日本語チャンネル", "English Channel"])("saves/restores and applies normalized channel %s without relaxing validation", (channel) => {
    const {doc, initial} = fixture(channel);
    doc.overlays.fonts.channel = contentTextFont(channel, doc.overlays.fonts.channel, true);
    const normalized = createEditorDocumentSnapshotV3(doc);
    const differs = channel !== "English Channel";
    expect(initialEditorRenderSpecMatchesDocument(normalized, initial)).toBe(!differs);
    const stale = {...normalized, renderSpec: initial};
    expect(editorDraftDocumentSnapshotSchema.safeParse(stale).success).toBe(!differs);
    const seeded = seedEditorDocumentInitialRenderSpec(normalized, initial);
    expect(editorDraftDocumentSnapshotSchema.safeParse(seeded).success).toBe(true);
    expect(parseEditorDraftRecord(createEditorDraftRecord(seeded))).not.toBeNull();
    expect(shouldPreserveInitialEditorRenderSpec(stale, initial, editorDocumentSemanticFingerprint(stale))).toBe(!differs);
    const compiled = {...initial, channel: {...initial.channel, font: resolveEditorFontFaceV4(normalized.overlays.fonts.channel, "channel")}};
    const merged = preserveUnchangedInitialRenderSpecLayers(compiled, normalized, initial, editorInitialRenderSpecLayerFingerprints(normalized));
    expect(merged.title).toEqual(initial.title);
    expect(merged.channel.font).toEqual(compiled.channel.font);
    editorDocumentSnapshotSchema.parse({...normalized, renderSpec: merged});
    expect(initial.channel.font.fontId).toBe("pretendard");
  });
});
