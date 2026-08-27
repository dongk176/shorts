import { describe, expect, it } from "vitest";
import { createEditorDocumentSnapshot } from "./editor-document-snapshot";
import { createInitialEditorOverlayLayout } from "./editor-overlay-preview";
import {
  compileEditorRenderTitleSpecV4,
  createEditorRenderSpec,
  EDITOR_RENDER_SPEC_V4_VERSION,
  isQuantizedEditorRenderPx,
} from "./editor-render-spec";

function documentFixture() {
  return createEditorDocumentSnapshot({
    sourceShortId: "d164fb8d-d6e1-4232-8463-9115cdf7e561",
    baseRenderVersion: 3,
    template: {
      id: "comment-capture",
      customTemplateId: null,
      presetVersion: 3,
      snapshot: {
        config: {
          title: {
            x: 15,
            y: 5,
            maxWidth: 210,
            fontSize: 72,
            primaryBackgroundColor: null,
            accentBackgroundColor: null,
          },
        },
      },
    },
    title: {
      text: "넓은 제목",
      textStyles: [{ start: 0, end: 2, color: "#FFFFFF" }],
      fontScale: 1,
    },
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
      aspectRatio: "16:9",
      timelineStartSeconds: 0,
      timelineEndSeconds: 3,
      selectionStartSeconds: 0,
      selectionEndSeconds: 3,
    },
  });
}

describe("editor render specification v4 title compiler", () => {
  it("uses deterministic em boxes, padding, absolute clamp, and 0.001px coordinates", () => {
    const title = compileEditorRenderTitleSpecV4(
      documentFixture(),
      (text, fontSize) => ({
        width: Array.from(text).length * fontSize * 0.72 + 0.1234,
        actualBoundingBoxAscent: fontSize * 0.76 + 0.0004,
        actualBoundingBoxDescent: fontSize * 0.24 + 0.0004,
      }),
    );

    expect(title.fontSize).toBeLessThan(72);
    expect(title.linePaddingX).toBeGreaterThan(0);
    expect(title.linePaddingY).toBeGreaterThan(0);
    expect(title.clamp).toEqual({ minX: 0, maxX: 1080, minY: 0, maxY: 1920 });
    expect(title.lineBoxes).toHaveLength(title.lines.length);
    expect(title.lineBoxes.every((line) => (
      line.centerX - line.width / 2 >= 0
      && line.centerX + line.width / 2 <= 1080
      && line.centerY - line.height / 2 >= 0
      && line.centerY + line.height / 2 <= 1920
      && line.baselineY >= line.centerY - line.height / 2
      && line.baselineY <= line.centerY + line.height / 2
    ))).toBe(true);
    const numericCoordinates = [
      title.centerX,
      title.centerY,
      title.offsetY,
      title.fontSize,
      title.lineGap,
      title.linePaddingX,
      title.linePaddingY,
      ...title.lineBoxes.flatMap((line) => [
        line.centerX,
        line.centerY,
        line.width,
        line.height,
        line.baselineY,
      ]),
    ];
    expect(numericCoordinates.every(isQuantizedEditorRenderPx)).toBe(true);
    expect(title.lineBoxes.every(
      (line) => line.height === title.fontSize + title.linePaddingY * 2,
    )).toBe(true);
  });

  it("does not let platform-specific glyph ink bounds move title lines", () => {
    const compile = (ascent: number, descent: number) => (
      compileEditorRenderTitleSpecV4(
        documentFixture(),
        (text, fontSize) => ({
          width: Array.from(text).length * fontSize * 0.72,
          actualBoundingBoxAscent: fontSize * ascent,
          actualBoundingBoxDescent: fontSize * descent,
        }),
      )
    );

    const macLike = compile(0.72, 0.18);
    const linuxLike = compile(0.84, 0.27);

    expect(linuxLike.lineBoxes).toEqual(macLike.lineBoxes);
    expect(linuxLike.centerY).toBe(macLike.centerY);
  });

  it("never silently creates v4 through the synchronous legacy compiler", () => {
    expect(() => createEditorRenderSpec(
      documentFixture(),
      undefined,
      EDITOR_RENDER_SPEC_V4_VERSION,
    )).toThrow("requires exact asynchronous font measurement");
  });

  it("rebuilds line boxes for a moved title and a longer title", () => {
    const centered = documentFixture();
    centered.template.snapshot = { presetVersion: 3 };
    centered.title.text = "짧은 제목";
    const moved = structuredClone(centered);
    moved.overlays.offsets.title.x = 120;
    moved.title.text = "길어진 제목은 새로운 줄 상자를 다시 계산합니다";
    const measure = (text: string, fontSize: number) => ({
      width: Array.from(text).length * fontSize * 0.72,
      actualBoundingBoxAscent: fontSize * 0.76,
      actualBoundingBoxDescent: fontSize * 0.24,
    });

    const initialTitle = compileEditorRenderTitleSpecV4(centered, measure);
    const editedTitle = compileEditorRenderTitleSpecV4(moved, measure);

    expect(editedTitle.centerX).toBeGreaterThan(initialTitle.centerX);
    expect(editedTitle.lineBoxes.map((line) => line.text)).not.toEqual(
      initialTitle.lineBoxes.map((line) => line.text),
    );
    expect(editedTitle.lineBoxes).not.toEqual(initialTitle.lineBoxes);
  });

  it("matches the worker default size and comment-capture 9:16 title panel", () => {
    const document = documentFixture();
    document.template.snapshot = { presetVersion: 3 };
    document.video.aspectRatio = "9:16";
    document.title.text = "짧은 제목";

    const title = compileEditorRenderTitleSpecV4(
      document,
      (text, fontSize) => ({
        width: Array.from(text).length * fontSize * 0.5,
        actualBoundingBoxAscent: fontSize * 0.76,
        actualBoundingBoxDescent: fontSize * 0.24,
      }),
    );

    expect(title.fontSize).toBe(84);
    expect(title.centerY).toBeLessThan(285);
    expect(title.lineBoxes.every((line) => line.centerY < 285)).toBe(true);
  });
});
