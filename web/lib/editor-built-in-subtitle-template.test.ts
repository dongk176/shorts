import { describe, expect, it } from "vitest";
import { createEditorDocumentSnapshot } from "./editor-document-snapshot";
import { createInitialEditorOverlayLayout } from "./editor-overlay-preview";
import { compileEditorRenderTitleSpecV4 } from "./editor-render-spec";
import { resolveBuiltInSubtitleTemplateSnapshot } from "./editor-built-in-subtitle-template";
import { createUnifiedSubtitleTemplateConfig } from "./template-config";

const measure = (text: string, fontSize: number) => ({
  width: Array.from(text).length * fontSize * 0.72,
  actualBoundingBoxAscent: fontSize * 0.76,
  actualBoundingBoxDescent: fontSize * 0.24,
});

function documentWithSnapshot(snapshot: NonNullable<ReturnType<
  typeof resolveBuiltInSubtitleTemplateSnapshot
>>) {
  return createEditorDocumentSnapshot({
    sourceShortId: "a17b77e2-af38-441a-98d5-f45164c1f7e6",
    baseRenderVersion: 1,
    template: {
      id: "dark-minimal",
      customTemplateId: null,
      presetVersion: 3,
      snapshot,
    },
    title: {
      text: "첫 번째 줄\n두 번째 줄",
      textStyles: [],
      fontScale: 1,
    },
    channel: {
      displayName: "EasyCut",
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

describe("built-in subtitle template editor snapshot", () => {
  it.each(["highlight", "pop"] as const)(
    "keeps the %s title anchor through color and position edits",
    (subtitleTemplateId) => {
      const snapshot = resolveBuiltInSubtitleTemplateSnapshot({
        templateId: "dark-minimal",
        subtitleTemplateId,
        templateSnapshot: { presetVersion: 3 },
        accentColor: "#ff715e",
      });
      expect(snapshot).not.toBeNull();
      const initial = documentWithSnapshot(snapshot!);
      const recolored = structuredClone(initial);
      recolored.title.textStyles = [{ start: 0, end: 2, color: "#22C55E" }];
      const moved = structuredClone(recolored);
      moved.overlays.offsets.title.y = -15;

      const initialTitle = compileEditorRenderTitleSpecV4(initial, measure);
      const recoloredTitle = compileEditorRenderTitleSpecV4(recolored, measure);
      const movedTitle = compileEditorRenderTitleSpecV4(moved, measure);

      expect(snapshot?.config).toMatchObject({
        schemaVersion: 5,
        title: { y: 295, accentColor: "#FF715E" },
        subtitle: { variant: subtitleTemplateId, accentColor: "#FF715E" },
      });
      expect(recoloredTitle.centerY).toBe(initialTitle.centerY);
      expect(movedTitle.centerY).toBe(initialTitle.centerY - 15);
    },
  );

  it("prefers the original full layout over a reduced saved editor snapshot", () => {
    const original = {
      presetVersion: 3,
      config: createUnifiedSubtitleTemplateConfig("highlight"),
    };
    expect(resolveBuiltInSubtitleTemplateSnapshot({
      templateId: "dark-minimal",
      subtitleTemplateId: "highlight",
      templateSnapshot: { presetVersion: 3 },
      fallbackTemplateSnapshot: original,
    })).toEqual(original);
  });

  it("does not reinterpret ordinary or custom templates", () => {
    expect(resolveBuiltInSubtitleTemplateSnapshot({
      templateId: "comment-capture",
      subtitleTemplateId: "highlight",
    })).toBeNull();
    expect(resolveBuiltInSubtitleTemplateSnapshot({
      templateId: "dark-minimal",
      customTemplateId: "cda07dda-6058-4c9b-9d3e-2dbda9625158",
      subtitleTemplateId: "pop",
    })).toBeNull();
  });
});
