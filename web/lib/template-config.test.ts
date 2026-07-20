import { describe, expect, it } from "vitest";
import { COMMENT_BACKGROUND_COLOR, createDefaultTemplateConfig, templateConfigSchema, templatePresetColorOptions, templatePresetColors, videoFrameForAspect } from "@/lib/template-config";

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
    expect(createDefaultTemplateConfig().subtitle.visible).toBe(false);
  });

  it("starts comment capture templates with the channel layer hidden", () => {
    const commentConfig = createDefaultTemplateConfig("comment-capture");
    expect(commentConfig.channel.visible).toBe(false);
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

  it("provides a display name for every selectable template color", () => {
    expect(templatePresetColorOptions.map((option) => option.color)).toEqual(templatePresetColors);
    expect(templatePresetColorOptions.every((option) => option.name.length > 0)).toBe(true);
  });
});
