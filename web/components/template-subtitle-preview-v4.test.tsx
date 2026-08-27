import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { editorCaptionCssToAssScaleById } from "../lib/editor-fonts";
import { createUnifiedSubtitleTemplateConfig } from "../lib/template-config";
import { compileTemplateSubtitlePreviewGeometryV4 } from "../lib/template-subtitle-preview-v4";

const previewSource = readFileSync(
  new URL("./template-subtitle-preview.tsx", import.meta.url),
  "utf8",
);
const geometrySource = readFileSync(
  new URL("../lib/template-subtitle-preview-v4.ts", import.meta.url),
  "utf8",
);

const shortsAppSource = readFileSync(
  new URL("../app/shorts-app.tsx", import.meta.url),
  "utf8",
);
const templateLibrarySource = readFileSync(
  new URL("../app/templates/template-library.tsx", import.meta.url),
  "utf8",
);
const templateEditorSource = readFileSync(
  new URL("../app/templates/template-editor.tsx", import.meta.url),
  "utf8",
);

describe("V4 positioned subtitle preview isolation", () => {
  it("keeps the default template preview on its legacy layout", () => {
    expect(previewSource).toContain("positionedWordsV4Enabled = false");
    expect(previewSource).toContain('gap-[.18em] whitespace-nowrap');
  });

  it("uses absolute advance boxes only when the explicit V4 preview prop is on", () => {
    expect(previewSource).toContain(
      "if (positionedWordsV4Enabled) return <ExactTemplateSubtitlePreview",
    );
    expect(previewSource).toContain("<PositionedSubtitleWords");
    expect(previewSource).toContain(
      'resolveEditorFontFaceV4(subtitle.fontId, "title")',
    );
    expect(previewSource).toContain(
      "ensureEditorFontFaceV4Loaded(positionedFont, sample)",
    );
    expect(previewSource).toContain(
      "compileTemplateSubtitlePreviewGeometryV4(",
    );
    expect(geometrySource).toContain(
      "measureEditorCaptionTextV4(text, fontSize, subtitle.fontId)",
    );
    expect(geometrySource).toContain(
      "gapBefore: word.spaceBefore ? POSITIONED_SUBTITLE_WORD_GAP_PX : 0",
    );
    expect(geometrySource).not.toContain("Array.from(word.text).length");
  });

  it.each([
    ["pop", "한글 자막"],
    ["pop", "English caption"],
    ["pop", "한글 English 123"],
    ["highlight", "한글 자막"],
    ["highlight", "English caption"],
    ["highlight", "한글 English 123"],
  ] as const)(
    "measures %s template-card fixtures with exact injected advances: %s",
    (variant, text) => {
      const config = createUnifiedSubtitleTemplateConfig(variant);
      config.subtitle.fontId = "paperlogy";
      config.subtitle.fontSize = 84;
      const words = text.split(" ").map((word, index) => ({
        text: word,
        active: index === 0,
        spaceBefore: index > 0,
      }));
      const measured: string[] = [];
      const geometry = compileTemplateSubtitlePreviewGeometryV4(
        config.subtitle,
        words,
        (value, fontSize) => {
          measured.push(value);
          return Array.from(value).length * fontSize * 0.5;
        },
      );

      expect(measured).toEqual(words.map((word) => word.text));
      expect(geometry.cssToAssScale).toBe(
        editorCaptionCssToAssScaleById.paperlogy,
      );
      expect(geometry.positions).toHaveLength(words.length);
      expect(geometry.positions.map((position) => position.gapBefore))
        .toEqual(words.map((_word, index) => index === 0 ? 0 : 6));
      expect(geometry.positions.every((position) => (
        Number.isFinite(position.centerX)
        && Number.isFinite(position.advanceWidth)
      ))).toBe(true);
    },
  );

  it("changes card geometry independently with font calibration and size", () => {
    const config = createUnifiedSubtitleTemplateConfig("pop");
    const words = [
      { text: "자막", active: true, spaceBefore: false },
      { text: "preview", active: false, spaceBefore: true },
    ];
    config.subtitle.fontId = "pretendard";
    config.subtitle.fontSize = 60;
    const pretendard = compileTemplateSubtitlePreviewGeometryV4(
      config.subtitle,
      words,
      (text, size) => Array.from(text).length * size * 0.5,
    );
    config.subtitle.fontId = "paperlogy";
    const paperlogySameSize = compileTemplateSubtitlePreviewGeometryV4(
      config.subtitle,
      words,
      (text, size) => Array.from(text).length * size * 0.5,
    );
    config.subtitle.fontSize = 96;
    const paperlogy = compileTemplateSubtitlePreviewGeometryV4(
      config.subtitle,
      words,
      (text, size) => Array.from(text).length * size * 0.5,
    );

    expect(paperlogySameSize.positions[0].advanceWidth).not.toBe(
      pretendard.positions[0].advanceWidth,
    );
    expect(paperlogy.positions[0].advanceWidth).not.toBe(
      paperlogySameSize.positions[0].advanceWidth,
    );
    expect(paperlogy.positions[0].advanceWidth).toBe(
      Math.round(
        2 * 96 * 0.5 * 1.12 * editorCaptionCssToAssScaleById.paperlogy
          * 1_000,
      ) / 1_000,
    );
  });

  it("requires the public V4 gate in cards, the template editor, and project previews", () => {
    expect(templateLibrarySource).toContain(
      "const positionedWordsV4Enabled = isEditorRenderSpecV4Enabled()",
    );
    expect(templateEditorSource).toContain(
      "const positionedWordsV4Enabled = isEditorRenderSpecV4Enabled()",
    );
    expect(shortsAppSource).toContain("function captionV4PositionedWordBoxes(");
    expect(shortsAppSource).toContain("if (!isEditorRenderSpecV4Enabled()) return null;");
    expect(shortsAppSource).toContain(
      'runtimeSpec.layoutMode !== "absolute-word-positions-v1"',
    );
    expect(shortsAppSource).toContain("positions={positionedV4Boxes}");
    expect(shortsAppSource).toContain(
      "? spec.font.metrics.cssToAssScale",
    );
    expect(shortsAppSource).toContain("? 1.12\n    : 1");
    expect(shortsAppSource).toContain(
      '? resolveEditorFontFaceV4(captionFontId, "title")',
    );
    const v4Branch = shortsAppSource.slice(
      shortsAppSource.indexOf("{positionedV4Boxes && positionedV4Bounds"),
      shortsAppSource.indexOf(': spec.templateId === "pop"'),
    );
    expect(v4Branch).not.toContain("CAPTION_ASS_PREVIEW_FONT_SCALE");
    expect(v4Branch).not.toContain("fontSizeScale=");
    expect(shortsAppSource).toContain(
      ": CAPTION_ASS_PREVIEW_FONT_SCALE;",
    );
    expect(shortsAppSource).toContain(
      "? spec.font.metrics.cssToAssScale",
    );
  });
});
