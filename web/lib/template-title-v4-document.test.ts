import { describe, expect, it } from "vitest";
import { compileEditorRenderTitleSpecV4 } from "./editor-render-spec";
import {
  createDefaultTemplateConfig,
  upgradeTemplateConfigToV5,
} from "./template-config";
import { createTemplateTitleV4DocumentInput } from "./template-title-v4-document";

describe("template title v4 preview document", () => {
  it("carries custom template geometry, colors, visibility, and exact font into v4 line boxes", () => {
    const config = upgradeTemplateConfigToV5(
      createDefaultTemplateConfig("dark-minimal"),
    );
    config.title.x = 516;
    config.title.y = 382;
    config.title.maxWidth = 720;
    config.title.fontSize = 81;
    config.title.primaryBackgroundColor = "#111111";
    config.title.accentBackgroundColor = "#E32626";
    config.title.fontId = "paperlogy";
    const document = createTemplateTitleV4DocumentInput({
      templateId: "dark-minimal",
      title: "첫째 줄\n둘째 줄",
      templateConfig: config,
    });

    const title = compileEditorRenderTitleSpecV4(
      document,
      (text, fontSize) => ({
        width: Array.from(text).length * fontSize * 0.7,
        actualBoundingBoxAscent: fontSize * 0.75,
        actualBoundingBoxDescent: fontSize * 0.25,
      }),
    );

    expect(document.overlays.fonts.title).toBe("paperlogy");
    expect(document.video.aspectRatio).toBe(config.video.aspectRatio);
    expect(document.template.snapshot).toMatchObject({ config });
    expect(title.font.fontId).toBe("paperlogy");
    expect(title.centerX).toBe(516);
    expect(title.centerY).toBe(382);
    expect(title.fontSize).toBe(81);
    expect(title.lineGap).toBe(15);
    expect(title.lineBoxes.map((line) => line.backgroundRuns)).toEqual([
      [{
        start: 0,
        end: 4,
        color: "#111111",
        x: 399.04,
        y: 271.5,
        width: 233.92,
        height: 103,
        radius: 11,
      }],
      [{
        start: 0,
        end: 4,
        color: "#E32626",
        x: 399.04,
        y: 389.5,
        width: 233.92,
        height: 103,
        radius: 11,
      }],
    ]);
  });

  it("keeps preset previews on preset geometry while preserving explicit aspect and title styles", () => {
    const document = createTemplateTitleV4DocumentInput({
      templateId: "comment-capture",
      title: "댓글 반응과 함께\n시청 지속시간 상승",
      videoAspectRatio: "16:9",
      textStyles: [{ start: 9, end: 18, backgroundColor: "#E32626" }],
    });

    expect(document.template.customTemplateId).toBeNull();
    expect(document.template.snapshot).toEqual({ presetVersion: 3 });
    expect(document.video.aspectRatio).toBe("16:9");
    expect(document.title.textStyles).toEqual([
      { start: 9, end: 18, backgroundColor: "#E32626" },
    ]);
  });
});
