import { subtitleRatioCases } from "../test/subtitle-ratio-cases";
import { builtInSubtitlePresentation } from "./built-in-subtitle-presentation";
import { describe, expect, it } from "vitest";
import { createEditorDocumentSnapshot } from "./editor-document-snapshot";
import { createInitialEditorOverlayLayout } from "./editor-overlay-preview";
import { compileEditorRenderTitleSpecV4 } from "./editor-render-spec";
import { resolveEditorVideoPreviewFrame } from "./custom-template-preview-layout";
import { subtitleTemplateStyleSnapshot } from "./subtitle-templates";
import { builtInSubtitleVideoConfig, builtInSubtitleChannelRect, resolveBuiltInSubtitleTemplateSnapshot } from "./editor-built-in-subtitle-template";
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
  it.each(subtitleRatioCases)("uses the saved video frame through save/reopen for $id $videoAspectRatio $captionPlacement", (test) => {
    const config = builtInSubtitlePresentation(test).config;
    const snapshot = { presetVersion: 4, config };
    const legacy = subtitleTemplateStyleSnapshot(test.id, test.videoAspectRatio, "#35E6E3", test.captionPlacement).layout.video;
    for (const stored of [snapshot, JSON.parse(JSON.stringify(snapshot))]) {
      const frame = resolveEditorVideoPreviewFrame({
        customTemplateConfig: builtInSubtitleVideoConfig(stored),
        captionVideoFrame: legacy, fallbackFrame: legacy,
      });
      expect(frame).toEqual(config.video);
      expect(frame.y + 66).toBe(config.video.y + 66);
    }
  });

  it("matches project 27094's saved 636px video position without rewriting its offset", () => {
    const config = builtInSubtitlePresentation({ id: "pop", videoAspectRatio: "1:1" }).config;
    const frame = resolveEditorVideoPreviewFrame({
      customTemplateConfig: builtInSubtitleVideoConfig({ config }),
      captionVideoFrame: { x: 0, y: 420, width: 1080, height: 1080 },
      fallbackFrame: { x: 0, y: 420, width: 1080, height: 1080 },
    });
    expect(frame.y + 66).toBe(636);
    expect(builtInSubtitleVideoConfig({ presetVersion: 3 })).toBeNull();
  });

  it.each(subtitleRatioCases)("previews saved channel position for $id $videoAspectRatio $captionPlacement despite an older caption layout", (test) => {
    const legacy = builtInSubtitlePresentation({ ...test, legacyChannelPosition: true });
    const current = builtInSubtitlePresentation(test);
    const snapshot = { presetVersion: 4, config: current.config };
    const saved = resolveBuiltInSubtitleTemplateSnapshot({
      templateId: "dark-minimal", subtitleTemplateId: test.id,
      templateSnapshot: JSON.parse(JSON.stringify(snapshot)),
      videoAspectRatio: test.videoAspectRatio,
    });
    const rect = builtInSubtitleChannelRect(saved, legacy.style.layout.channel);
    expect(rect.x + rect.width / 2).toBe(540);
    expect(rect.y + rect.height / 2).toBe(test.channelY);
    expect(rect.width).toBe(legacy.style.layout.channel.width);
    expect(rect.height).toBe(legacy.style.layout.channel.height);
    expect(saved).toEqual(snapshot);
    expect(builtInSubtitleChannelRect({ config: legacy.config }, rect))
      .toEqual(legacy.style.layout.channel);
  });

  it("keeps saved channel anchors and leaves snapshots without v5 channel geometry unchanged", () => {
    const fallback = { x: 0, y: 1710, width: 1080, height: 160 };
    const config = createUnifiedSubtitleTemplateConfig("highlight");
    config.channel.y = 1470;
    expect(builtInSubtitleChannelRect({ config }, fallback)).toEqual({ ...fallback, y: 1390 });
    expect(builtInSubtitleChannelRect({ presetVersion: 3 }, fallback)).toBe(fallback);
    expect(builtInSubtitleChannelRect(null, fallback)).toBe(fallback);
  });

  it.each(subtitleRatioCases)("restores $id $videoAspectRatio $captionPlacement and preserves the saved snapshot", (test) => {
    const expected = builtInSubtitlePresentation({ ...test, legacyChannelPosition: true, legacyLayout: true }).config;
    const input = {
      templateId: "dark-minimal" as const, subtitleTemplateId: test.id,
      videoAspectRatio: test.videoAspectRatio, captionPlacement: test.captionPlacement,
    };
    const restored = resolveBuiltInSubtitleTemplateSnapshot(input)!;
    expect(restored.config).toEqual(expected);
    // Saving and reopening must retain an existing full snapshot even if fallback fields differ.
    const saved = JSON.parse(JSON.stringify(restored));
    expect(resolveBuiltInSubtitleTemplateSnapshot({ ...input, videoAspectRatio: "16:9", templateSnapshot: saved }))
      .toEqual(restored);
    expect(resolveBuiltInSubtitleTemplateSnapshot({ ...input, templateSnapshot: { presetVersion: 3 }, fallbackTemplateSnapshot: saved }))
      .toEqual(restored);
  });
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
