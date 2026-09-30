import { describe, expect, it } from "vitest";
import { builtInSubtitlePresentation } from "./built-in-subtitle-presentation";
import { contrastingTitleTextColor } from "./brand-color-contrast";
import { createUnifiedSubtitleTemplateConfig, templateConfigSchema, templatePresetColors } from "./template-config";
import { createInitialRenderContract } from "./initial-render-contract";
import { subtitleRatioCases } from "../test/subtitle-ratio-cases";

describe("built-in subtitle ratio contract", () => {
  it.each(subtitleRatioCases)("$id $videoAspectRatio $captionPlacement agrees with preview for all 21 colors", (test) => {
    expect(templatePresetColors).toHaveLength(21);
    for (const brandColor of templatePresetColors) {
      const preview = builtInSubtitlePresentation({ ...test, brandColor });
      const contract = createInitialRenderContract({
        resolvedExecution: {
          resolvedTemplateId: "dark-minimal", resolvedVideoAspectRatio: test.videoAspectRatio,
          templateSnapshot: { presetVersion: 3, brandColor }, subtitleTemplateSnapshot: null,
          usesUnifiedTemplateSubtitleCanary: false,
        },
        subtitleTemplateId: test.id, subtitleCaptionPlacement: test.captionPlacement,
        brandColor, enhancedSubtitleTiming: false,
      });
      expect(templateConfigSchema.parse(preview.config)).toEqual(preview.config);
      expect(preview.config).toMatchObject({
        video: { aspectRatio: test.videoAspectRatio, x: 0, y: test.y, width: 1080, height: test.height },
        title: { y: test.titleY }, subtitle: { y: test.captionY, accentColor: brandColor },
        channel: { y: test.channelY },
      });
      expect(preview.style.layout.caption).toEqual({ x: 120, y: test.captionY - 70, width: 840, height: 140 });
      expect(contract.videoAspectRatio).toBe(test.videoAspectRatio);
      expect(contract.templateSnapshot).toMatchObject({ config: preview.config });
      expect(contract.subtitleTemplateSnapshot).toMatchObject({
        ...preview.style, schemaVersion: 4, origin: "unified-template-v5", enabled: true,
      });
      if (test.videoAspectRatio === "9:16") {
        expect(preview.config.title).toMatchObject({
          primaryBackgroundColor: brandColor, accentBackgroundColor: brandColor,
          primaryColor: contrastingTitleTextColor(brandColor), accentColor: contrastingTitleTextColor(brandColor),
        });
      } else {
        expect(preview.config.title.accentColor).toBe(brandColor);
      }
    }
  });
  it.each(["highlight", "pop"] as const)("preserves the established 16:9 lower %s layout", (id) => {
    expect(builtInSubtitlePresentation({ id, videoAspectRatio: "16:9", legacyChannelPosition: true }).config)
      .toEqual(createUnifiedSubtitleTemplateConfig(id));
  });
});


describe("lowered subtitle defaults", () => {
  it.each(subtitleRatioCases)("$id $videoAspectRatio $captionPlacement preserves spacing and stays on canvas", (test) => {
    const previous = builtInSubtitlePresentation({ ...test, legacyLayout: true });
    const next = builtInSubtitlePresentation(test);
    const shift = test.videoAspectRatio === "9:16" ? 0 : 150;
    expect(next.config.title.y - previous.config.title.y).toBe(150);
    expect(next.config.video.y - previous.config.video.y).toBe(shift);
    expect(next.config.subtitle.y - previous.config.subtitle.y).toBe(shift);
    expect(next.config.channel.y - previous.config.channel.y).toBe(shift);
    expect(next.style.safeArea).toEqual(next.style.layout.caption);
    for (const rect of Object.values(next.style.layout)) {
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.y + rect.height).toBeLessThanOrEqual(1920);
    }
  });
});
