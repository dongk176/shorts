import { describe, expect, it } from "vitest";
import { templateIds } from "@/lib/contracts";
import {
  COMMENT_BACKGROUND_COLOR,
  COMMENT_CAPTURE_LANDSCAPE_LIFT_PX,
  createDefaultTemplateConfig,
  createUnifiedSubtitleTemplateConfig,
  isTemplateConfigV5,
  templateConfigSchema,
  templatePresetColorOptions,
  templatePresetColors,
  upgradeTemplateConfigToV5,
  videoFrameForAspect,
} from "@/lib/template-config";

describe("personal template config", () => {
  it("creates bounded frames for every supported aspect ratio", () => {
    for (const ratio of ["16:9", "5:4", "1:1", "4:5", "9:16"] as const) {
      const frame = videoFrameForAspect(ratio);
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(1080);
      expect(frame.y + frame.height).toBeLessThanOrEqual(1920);
    }
  });

  it("rejects an arbitrary color outside the fixed palette", () => {
    const config = createDefaultTemplateConfig();
    expect(() => templateConfigSchema.parse({
      ...config,
      background: { kind: "color", color: "#123456" },
    })).toThrow();
  });

  it("keeps subtitles disabled while the template subtitle feature is hidden", () => {
    const config = createDefaultTemplateConfig();
    expect(config.schemaVersion).toBe(4);
    expect(config.subtitle.visible).toBe(false);
  });

  it("upgrades a legacy template only when the admin subtitle editor requests v5", () => {
    const legacy = createDefaultTemplateConfig("paper");
    legacy.subtitle.y = 1320;
    legacy.subtitle.fontSize = 64;
    legacy.subtitle.color = "#FFFFFF";

    const upgraded = upgradeTemplateConfigToV5(legacy);

    expect(legacy.schemaVersion).toBe(4);
    expect(upgraded).toMatchObject({
      schemaVersion: 5,
      title: {
        fontId: "pretendard",
      },
      subtitle: {
        visible: false,
        variant: "highlight",
        x: 540,
        y: 1320,
        fontId: "pretendard",
        fontSize: 64,
        color: "#FFFFFF",
        accentColor: "#FFD84D",
      },
    });
    expect(isTemplateConfigV5(upgraded)).toBe(true);
    expect(upgraded.subtitle).not.toHaveProperty("backgroundColor");
    expect(templateConfigSchema.parse(upgraded)).toEqual(upgraded);
  });

  it.each(templateIds)(
    "round-trips every %s preset with all unified subtitle settings",
    (templateId) => {
      const config = upgradeTemplateConfigToV5(
        createDefaultTemplateConfig(templateId),
      );
      config.title.fontId = "paperlogy";
      config.subtitle = {
        ...config.subtitle,
        visible: true,
        variant: "pop",
        y: 1_260,
        fontId: "paperlogy",
        fontSize: 88,
        color: "#FFFFFF",
        accentColor: "#FF715E",
      };

      const restored = templateConfigSchema.parse(
        JSON.parse(JSON.stringify(config)),
      );
      expect(restored).toEqual(config);
    },
  );

  it("creates pop and highlight seeds as ordinary v5 personal templates", () => {
    const highlight = createUnifiedSubtitleTemplateConfig("highlight");
    const pop = createUnifiedSubtitleTemplateConfig("pop");

    expect(highlight.subtitle).toMatchObject({
      visible: true,
      variant: "highlight",
      x: 540,
      fontSize: 72,
      accentColor: "#35E6E3",
    });
    expect(pop.subtitle).toMatchObject({
      visible: true,
      variant: "pop",
      x: 540,
      fontSize: 92,
      accentColor: "#35E6E3",
    });
    expect(highlight.subtitle).not.toHaveProperty("backgroundColor");
    expect(pop.subtitle).not.toHaveProperty("backgroundColor");
  });

  it("fixes v5 subtitles to the horizontal center and bounded font sizes", () => {
    const config = createUnifiedSubtitleTemplateConfig("highlight");
    expect(() => templateConfigSchema.parse({
      ...config,
      subtitle: { ...config.subtitle, x: 520 },
    })).toThrow();
    expect(() => templateConfigSchema.parse({
      ...config,
      subtitle: { ...config.subtitle, fontSize: 121 },
    })).toThrow();
    expect(() => templateConfigSchema.parse({
      ...config,
      title: { ...config.title, fontId: "unknown-font" },
    })).toThrow();
    expect(() => templateConfigSchema.parse({
      ...config,
      subtitle: { ...config.subtitle, backgroundColor: "#000000" },
    })).toThrow();
  });

  it("stores Paperlogy for both v5 title and subtitle rendering", () => {
    const config = createUnifiedSubtitleTemplateConfig("pop");
    config.title.fontId = "paperlogy";
    config.subtitle.fontId = "paperlogy";

    expect(templateConfigSchema.parse(config)).toMatchObject({
      schemaVersion: 5,
      title: { fontId: "paperlogy" },
      subtitle: { fontId: "paperlogy" },
    });
  });

  it("starts new comment capture templates in 16:9 with the channel below comments", () => {
    const commentConfig = createDefaultTemplateConfig("comment-capture");
    const centeredLandscape = videoFrameForAspect("16:9");
    expect(commentConfig.video).toEqual({
      ...centeredLandscape,
      y: centeredLandscape.y - COMMENT_CAPTURE_LANDSCAPE_LIFT_PX,
    });
    expect(commentConfig.title.y).toBe(250 - COMMENT_CAPTURE_LANDSCAPE_LIFT_PX);
    expect(commentConfig.channel.visible).toBe(true);
    expect(commentConfig.channel.y).toBeGreaterThan(commentConfig.comment.y);
    expect(commentConfig.comment).toEqual({
      visible: true,
      theme: "dark",
      size: "medium",
      y: commentConfig.video.y + commentConfig.video.height,
      dockedToVideo: true,
    });
    expect(commentConfig.background).toEqual({ kind: "color", color: COMMENT_BACKGROUND_COLOR });
    expect(templatePresetColors).toContain(COMMENT_BACKGROUND_COLOR);
    expect(createDefaultTemplateConfig("dark-minimal").channel.visible).toBe(true);
  });

  it("upgrades a shared v1 title background and comment defaults into v3", () => {
    const current = createDefaultTemplateConfig();
    const { comment, ...legacyCurrent } = current;
    expect(comment).toBeDefined();
    const legacyTitle = {
      visible: current.title.visible,
      x: current.title.x,
      y: current.title.y,
      maxWidth: current.title.maxWidth,
      fontSize: current.title.fontSize,
      primaryColor: current.title.primaryColor,
      accentColor: current.title.accentColor,
    };
    const parsed = templateConfigSchema.parse({
      ...legacyCurrent,
      schemaVersion: 1,
      title: { ...legacyTitle, backgroundColor: "#E32626" },
    });
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.title.primaryBackgroundColor).toBe("#E32626");
    expect(parsed.title.accentBackgroundColor).toBe("#E32626");
    expect(parsed.title).not.toHaveProperty("backgroundColor");
    expect(parsed.comment.y).toBe(parsed.video.y + parsed.video.height);
    expect(parsed.comment.dockedToVideo).toBe(true);
  });

  it("upgrades v2 templates with renderable comment defaults", () => {
    const current = createDefaultTemplateConfig("comment-capture");
    const { comment, ...withoutComment } = current;
    expect(comment).toBeDefined();
    const parsed = templateConfigSchema.parse({ ...withoutComment, schemaVersion: 2 });
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.comment).toEqual({
      visible: true,
      theme: "dark",
      size: "medium",
      y: parsed.video.y + parsed.video.height,
      dockedToVideo: true,
    });
  });

  it("preserves saved legacy comment frame and channel visibility", () => {
    const saved = createDefaultTemplateConfig("comment-capture");
    saved.video = videoFrameForAspect("5:4");
    saved.channel.visible = false;
    saved.comment.y = saved.video.y + saved.video.height;
    const parsed = templateConfigSchema.parse(saved);

    expect(parsed.video).toEqual(videoFrameForAspect("5:4"));
    expect(parsed.channel.visible).toBe(false);
    expect(parsed.comment.y).toBe(parsed.video.y + parsed.video.height);
  });

  it("provides a display name for every selectable template color", () => {
    expect(templatePresetColorOptions.map((option) => option.color)).toEqual(templatePresetColors);
    expect(templatePresetColorOptions.every((option) => option.name.length > 0)).toBe(true);
  });
});
