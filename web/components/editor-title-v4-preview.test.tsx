import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./editor-title-v4-preview.tsx", import.meta.url),
  "utf8",
);
const shortsAppSource = readFileSync(
  new URL("../app/shorts-app.tsx", import.meta.url),
  "utf8",
);

describe("EditorTitleV4Preview", () => {
  it("uses the authoritative v4 line boxes and baseline without recentering", () => {
    expect(source).toContain('data-editor-v4-title-preview=""');
    expect(source).toContain("x: box.centerX - advanceWidth / 2");
    expect(source).toContain("y: box.baselineY");
    expect(source).toContain("textLength: advanceWidth");
    expect(source).toContain('lengthAdjust: "spacingAndGlyphs"');
    expect(source).toContain("const exactFontReady = readyExactFontKey === exactFontKey;");
    expect(source).toContain("ensureEditorFontFaceV4Loaded(exactFontFaceRef.current, sourceTitle)");
    expect(source).toContain("}, [exactFontKey, sourceTitle]);");
    expect(source).not.toContain("setExactFontReady(false)");
    expect(source).toContain("if (!spec.visible || !exactFontReady) return null;");
    expect(source).toContain("x: first.x - spec.linePaddingX");
    expect(source).toContain("height: box.height");
    expect(source).not.toContain("forceCenterX");
    expect(source).not.toContain("fitPreviewTitleFont");
    expect(source).not.toContain("wrapPreviewTitle");
  });

  it("wins the project preview branch before legacy template previews", () => {
    expect(shortsAppSource).toContain(
      'import { EditorTitleV4Preview } from "@/components/editor-title-v4-preview";',
    );
    const branchStart = shortsAppSource.indexOf(
      "renderSpec?.version === EDITOR_RENDER_SPEC_V4_VERSION\n"
      + "            ? <EditorTitleV4Preview",
    );
    const legacyStart = shortsAppSource.indexOf(
      ": activeCustomTemplate\n"
      + "              ? <CustomTemplateTitlePreview",
      branchStart,
    );
    expect(branchStart).toBeGreaterThan(-1);
    expect(legacyStart).toBeGreaterThan(branchStart);
    const v4Branch = shortsAppSource.slice(branchStart, legacyStart);
    expect(v4Branch).toContain("spec={renderSpec.title}");
    expect(v4Branch).toContain('zIndex={previewOverlayZIndex("title")}');
    expect(v4Branch).not.toContain("movementStyle=");
    expect(v4Branch).not.toContain("forceCenterX=");
  });
});
