import { describe, expect, it } from "vitest";
import { editorFontOptions, resolveEditorFontFace } from "@/lib/editor-fonts";
import { wrapEditorRenderText } from "@/lib/editor-render-spec";
import templateTextLayoutCases from "@/lib/fixtures/template-text-layout.json";
import { createDefaultTemplateConfig, templateConfigSchema } from "@/lib/template-config";
import {
  addTemplateTextOverlay,
  backgroundAssetImageUrl,
  hasTemplateDesignLayerOrder,
  moveTemplateTextLayer,
  removeTemplateTextOverlay,
  templateBackgroundStyle,
  templateDesignLayerOrder,
  templateDesignLayerZIndex,
  templateTextEditorValue,
  templateTextRenderSpec,
} from "@/lib/template-design-preview";

const textId = "9bfcc905-bbbf-46b5-812b-7fb1c5c0bde4";

describe("shared template design preview", () => {
  it.each(templateTextLayoutCases)("matches the shared worker line fixture at width $width for '$value'", ({ value, width, lines }) => {
    expect(wrapEditorRenderText(value, width)).toEqual(lines);
    const overlay = { ...addTemplateTextOverlay(createDefaultTemplateConfig(), textId).textOverlays![0], text: value, width };
    expect(templateTextRenderSpec(overlay).lines).toEqual(lines);
  });
  it("preserves old configs and their original stacking unless new design layers are present", () => {
    const config = createDefaultTemplateConfig();
    const before = JSON.stringify(config);
    expect(hasTemplateDesignLayerOrder(config)).toBe(false);
    expect(templateDesignLayerZIndex(config, "title")).toBeUndefined();
    expect(templateDesignLayerOrder(config)).toEqual(["video", "title", "comment", "channel"]);
    expect(JSON.stringify(config)).toBe(before);
    expect(Object.hasOwn(config, "textOverlays")).toBe(false);
    expect(Object.hasOwn(config, "layerOrder")).toBe(false);
  });

  it("resolves stock and private uploaded images through the same center-cover style", () => {
    expect(templateBackgroundStyle({ kind: "color", color: "#000000" })).toEqual({ backgroundColor: "#000000" });
    expect(templateBackgroundStyle({ kind: "image", assetId: "white-grid" })).toEqual({
      backgroundImage: 'url("/template-backgrounds/white-grid.png")',
      backgroundPosition: "center", backgroundSize: "cover",
    });
    expect(templateBackgroundStyle({ kind: "uploaded_image", assetId: textId })).toEqual({
      backgroundImage: `url("/api/background-assets/${textId}")`,
      backgroundPosition: "center", backgroundSize: "cover",
    });
    expect(() => backgroundAssetImageUrl('https://untrusted.invalid/image");')).toThrow();
  });

  it("adds template text without timing, leaving the original config untouched", () => {
    const config = createDefaultTemplateConfig();
    const result = addTemplateTextOverlay(config, textId);
    expect(templateConfigSchema.safeParse(result).success).toBe(true);
    expect(result.textOverlays).toHaveLength(1);
    expect(result.textOverlays?.[0]).not.toHaveProperty("startSeconds");
    expect(result.textOverlays?.[0]).not.toHaveProperty("endSeconds");
    expect(templateTextEditorValue(result.textOverlays![0])).toMatchObject({ startSeconds: 0, endSeconds: 1 });
    expect(config.textOverlays).toBeUndefined();
    expect(result.layerOrder).toEqual(["video", "title", "comment", `text:${textId}`, "channel"]);
  });

  it("keeps the 20 text limit while removal is retained as an explicitly empty array", () => {
    let config = createDefaultTemplateConfig();
    for (let index = 0; index < 20; index += 1) {
      config = addTemplateTextOverlay(config, `9bfcc905-bbbf-46b5-812b-${String(index).padStart(12, "0")}`);
    }
    expect(config.textOverlays).toHaveLength(20);
    expect(templateConfigSchema.safeParse(config).success).toBe(true);
    expect(() => addTemplateTextOverlay(config, textId)).toThrow("20개");
    for (const text of config.textOverlays || []) config = removeTemplateTextOverlay(config, text.id);
    expect(config.textOverlays).toEqual([]);
    expect(config.layerOrder).toEqual(["video", "title", "comment", "channel"]);
    expect(templateConfigSchema.safeParse(config).success).toBe(true);
  });

  it("reuses editor layer ordering and keeps the channel on top", () => {
    let config = addTemplateTextOverlay(createDefaultTemplateConfig(), textId);
    const frontmost = config.layerOrder;
    expect(moveTemplateTextLayer(config, textId, "forward", false).layerOrder).toEqual(frontmost);
    config = moveTemplateTextLayer(config, textId, "backward", false);
    expect(templateDesignLayerZIndex(config, `text:${textId}`)).toBeLessThan(templateDesignLayerZIndex(config, "title")!);
    config = moveTemplateTextLayer(config, textId, "backward", false);
    expect(config.layerOrder?.[0]).toBe(`text:${textId}`);
    expect(config.layerOrder?.at(-1)).toBe("channel");
    expect(templateConfigSchema.safeParse(config).success).toBe(true);
  });

  it.each(editorFontOptions.map((font) => font.id))("uses the canonical wrapping and resolved %s font", (fontId) => {
    const text = {
      ...addTemplateTextOverlay(createDefaultTemplateConfig(), textId).textOverlays![0],
      text: "한국어 긴 문장을 줄바꿈합니다\n\n다음 문장과 영어 ABCD",
      width: 320,
      fontId,
      offset: { x: 43, y: -72 },
    };
    const spec = templateTextRenderSpec(text);
    expect(spec.lines).toEqual(wrapEditorRenderText(text.text, 320));
    expect(spec.lines).toContain(" ");
    expect(spec.font).toEqual(resolveEditorFontFace(fontId, "text"));
    expect(spec).toMatchObject({ centerX: 583, centerY: 888, width: 320, fontSize: 72, lineHeight: 86 });
  });
});
