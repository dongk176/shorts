import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_FONT_ID,
  editorFontFamily,
  editorFontLabel,
  editorFontOptions,
  resolveEditorFontFace,
} from "@/lib/editor-fonts";

describe("editor fonts", () => {
  it("exposes all eight commercially usable Korean font choices", () => {
    expect(editorFontOptions).toHaveLength(8);
    expect(new Set(editorFontOptions.map((font) => font.id)).size).toBe(8);
  });

  it("uses Pretendard as the safe default", () => {
    expect(DEFAULT_EDITOR_FONT_ID).toBe("pretendard");
    expect(editorFontFamily(undefined)).toContain("Editor Pretendard");
    expect(editorFontLabel(undefined)).toBe("프리텐다드");
  });

  it("resolves a selected font to its bundled editor family", () => {
    expect(editorFontFamily("black-han-sans")).toContain("Editor Black Han Sans");
    expect(editorFontLabel("spoqa-han-sans-neo")).toBe("스포카 한 산스");
  });

  it("uses only real static weights and separates Noto title/text axes", () => {
    expect(resolveEditorFontFace("pretendard", "text")).toMatchObject({
      requestedWeight: 800,
      resolvedWeight: 700,
      variableWeight: null,
    });
    expect(resolveEditorFontFace("black-han-sans", "title")).toMatchObject({
      requestedWeight: 700,
      resolvedWeight: 400,
      variableWeight: null,
    });
    expect(resolveEditorFontFace("noto-serif-kr", "title")).toMatchObject({
      resolvedWeight: 700,
      variableWeight: 700,
    });
    expect(resolveEditorFontFace("noto-serif-kr", "text")).toMatchObject({
      resolvedWeight: 800,
      variableWeight: 800,
    });
  });
});
