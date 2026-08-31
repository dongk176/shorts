import { describe, expect, it } from "vitest";
import { createDefaultTemplateConfig, templateConfigSchema, type TemplateConfig } from "@/lib/template-config";
import { createEditorTextOverlay, createInitialEditorOverlayLayout } from "@/lib/editor-overlay-preview";
import { editorDocumentSnapshotSchema } from "@/lib/editor-document-contract";
import {
  isTemplateOriginText,
  replaceTemplateTextOverlays,
  storedShortHasCustomDesign,
  templateDesignFingerprint,
  templateHasCustomDesign,
  templateTextOverlaysForVideo,
  templateVersionRequiresConfirmation,
} from "@/lib/template-design";

const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";
const TEXT_ID = "22222222-2222-4222-8222-222222222222";
const ASSET_ID = "33333333-3333-4333-8333-333333333333";
function design(): TemplateConfig {
  const { startSeconds, endSeconds, ...overlay } = createEditorTextOverlay(TEXT_ID, 30);
  void startSeconds; void endSeconds;
  return {
    ...createDefaultTemplateConfig(),
    background: { kind: "uploaded_image", assetId: ASSET_ID },
    textOverlays: [{ ...overlay, text: "첫 줄\n\n한국어 긴 문장" }],
    layerOrder: ["video", `text:${TEXT_ID}`, "title", "comment", "channel"],
  };
}

describe("custom template design contract", () => {
  it("leaves old data and versions unchanged without optional-field backfills", () => {
    const old = createDefaultTemplateConfig();
    expect(templateConfigSchema.parse(old)).toEqual(old);
    expect(templateConfigSchema.parse(old)).not.toHaveProperty("textOverlays");
    expect(templateConfigSchema.parse(old)).not.toHaveProperty("layerOrder");
    expect(templateHasCustomDesign(old)).toBe(false);
  });
  it("accepts uploaded UUIDs and time-free text without changing schema versions", () => {
    for (const schemaVersion of [3, 4]) {
      expect(templateConfigSchema.parse({ ...design(), schemaVersion })).toMatchObject({ schemaVersion });
    }
    expect(templateConfigSchema.safeParse({ ...design(), background: { kind: "uploaded_image", assetId: "https://example.com/x" } }).success).toBe(false);
    expect(templateConfigSchema.safeParse({ ...design(), background: { kind: "uploaded_image", assetId: ASSET_ID, objectKey: "other/file" } }).success).toBe(false);
    const config = design();
    expect(templateConfigSchema.safeParse({ ...config, textOverlays: [{ ...config.textOverlays![0], startSeconds: 1 }] }).success).toBe(false);
  });
  it("rejects duplicate/missing layers, extra text, invalid colors and excessive text", () => {
    const config = design();
    expect(templateConfigSchema.safeParse({ ...config, textOverlays: [config.textOverlays![0], config.textOverlays![0]] }).success).toBe(false);
    expect(templateConfigSchema.safeParse({ ...config, layerOrder: ["video", "title", "comment", "channel"] }).success).toBe(false);
    for (const patch of [{ text: "가".repeat(121) }, { color: "red" }, { width: 1001 }, { scale: 3.1 }]) {
      expect(templateConfigSchema.safeParse({ ...config, textOverlays: [{ ...config.textOverlays![0], ...patch }] }).success).toBe(false);
    }
    const overlays = Array.from({ length: 20 }, (_, index) => ({ ...config.textOverlays![0], id: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}` }));
    expect(templateConfigSchema.safeParse({ ...config, layerOrder: undefined, textOverlays: overlays }).success).toBe(true);
    expect(templateConfigSchema.safeParse({ ...config, layerOrder: undefined, textOverlays: [...overlays, { ...overlays[0], id: ASSET_ID }] }).success).toBe(false);
  });
  it("allows legacy version-less requests only for old designs", () => {
    expect(templateVersionRequiresConfirmation(createDefaultTemplateConfig(), 3)).toBe(false);
    expect(templateVersionRequiresConfirmation(design(), 3)).toBe(true);
    expect(templateVersionRequiresConfirmation(design(), 3, 2)).toBe(true);
    expect(templateVersionRequiresConfirmation(design(), 3, 3)).toBe(false);
  });
  it("treats even empty optional text as a new worker contract, not legacy data", () => {
    const old = createDefaultTemplateConfig();
    const empty = { ...old, textOverlays: [] };
    expect(templateHasCustomDesign(empty)).toBe(true);
    expect(templateVersionRequiresConfirmation(empty, 3)).toBe(true);
    expect(storedShortHasCustomDesign({ templateSnapshot: { config: empty } })).toBe(true);
    expect(storedShortHasCustomDesign({ editorDocument: { template: { snapshot: { config: empty } } } })).toBe(true);
    expect(templateDesignFingerprint(empty)).not.toBe(templateDesignFingerprint(old));
  });
  it("canonicalizes uploaded and text UUIDs with their order before worker admission", () => {
    const id = "ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF";
    const config = design();
    const parsed = templateConfigSchema.parse({
      ...config,
      background: { kind: "uploaded_image", assetId: id },
      textOverlays: [{ ...config.textOverlays![0], id }],
      layerOrder: ["video", `text:${id}`, "title", "comment", "channel"],
    });
    expect(parsed.background).toEqual({ kind: "uploaded_image", assetId: id.toLowerCase() });
    expect(parsed).toMatchObject({
      textOverlays: [{ id: id.toLowerCase() }],
      layerOrder: ["video", `text:${id.toLowerCase()}`, "title", "comment", "channel"],
    });
  });
  it("guards new stored backgrounds and inherited text without disabling old manual text", () => {
    expect(storedShortHasCustomDesign({})).toBe(false);
    expect(storedShortHasCustomDesign({ templateSnapshot: { config: createDefaultTemplateConfig() } })).toBe(false);
    expect(storedShortHasCustomDesign({ editorDocument: { overlays: {
      textOverlays: [createEditorTextOverlay("manual-1", 30)],
    } } })).toBe(false);
    expect(storedShortHasCustomDesign({ templateSnapshot: { config: design() } })).toBe(true);
    expect(storedShortHasCustomDesign({ editorDocument: { template: { snapshot: { config: design() } } } })).toBe(true);
    expect(storedShortHasCustomDesign({ editorDocument: { overlays: {
      background: { kind: "uploaded_image", assetId: ASSET_ID },
    } } })).toBe(true);
    expect(storedShortHasCustomDesign({ editorDocument: { overlays: {
      textOverlays: templateTextOverlaysForVideo({ id: TEMPLATE_ID, config: design() }, 30),
    } } })).toBe(true);
  });
});

describe("template text origin and lifecycle", () => {
  it("seeds deterministic full-duration text with canonical raw newlines", () => {
    const seeded = templateTextOverlaysForVideo({ id: TEMPLATE_ID, config: design() }, 43.2);
    expect(seeded[0]).toMatchObject({ id: `tpl:${TEMPLATE_ID}:${TEXT_ID}`, startSeconds: 0, endSeconds: 43.2, text: "첫 줄\n\n한국어 긴 문장" });
    expect(isTemplateOriginText(seeded[0].id)).toBe(true);
    expect(isTemplateOriginText("manual-text-1")).toBe(false);
    expect(editorDocumentSnapshotSchema).toBeDefined();
  });
  it("replaces only inherited text and keeps manual content, timing and background", () => {
    const layout = createInitialEditorOverlayLayout();
    const manual = { ...createEditorTextOverlay("manual", 20), startSeconds: 3, endSeconds: 8 };
    layout.textOverlays = [manual, ...templateTextOverlaysForVideo({ id: TEMPLATE_ID, config: design() }, 20)];
    layout.layerOrder = ["video", "text:manual", "title", "comment", `text:tpl:${TEMPLATE_ID}:${TEXT_ID}`, "channel"];
    layout.background = { kind: "uploaded_image", assetId: ASSET_ID };
    const changed = replaceTemplateTextOverlays(layout, { id: ASSET_ID, config: design() }, 60);
    expect(changed.textOverlays).toHaveLength(2);
    expect(changed.textOverlays[0]).toEqual(manual);
    expect(changed.textOverlays[1].id).toBe(`tpl:${ASSET_ID}:${TEXT_ID}`);
    expect(changed.layerOrder).not.toContain(`text:tpl:${TEMPLATE_ID}:${TEXT_ID}`);
    expect(changed.layerOrder.indexOf("text:manual")).toBeLessThan(changed.layerOrder.indexOf("title"));
    expect(changed.background).toEqual(layout.background);
    expect(replaceTemplateTextOverlays(changed, null, 60).textOverlays).toEqual([manual]);
    expect(layout.textOverlays[1].id).toBe(`tpl:${TEMPLATE_ID}:${TEXT_ID}`);
  });
  it("refuses overflow without mutating the existing layout", () => {
    const layout = createInitialEditorOverlayLayout();
    layout.textOverlays = Array.from({ length: 20 }, (_, index) => createEditorTextOverlay(`manual-${index}`, 20));
    expect(() => replaceTemplateTextOverlays(layout, { id: TEMPLATE_ID, config: design() }, 20)).toThrow("20개");
    expect(layout.textOverlays).toHaveLength(20);
  });
});
