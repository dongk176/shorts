import { describe, expect, it } from "vitest";
import {
  customCanvasWidth,
  customCenteredLayerStyle,
  customCommentCanDockToVideo,
  customCommentLayerY,
  customVideoFrameStyle,
} from "@/lib/custom-template-preview-layout";
import { createDefaultTemplateConfig } from "@/lib/template-config";

describe("custom template preview geometry", () => {
  it("maps saved video pixels to the 1080 by 1920 preview without drift", () => {
    const style = customVideoFrameStyle({
      aspectRatio: "16:9",
      x: 140,
      y: 600,
      width: 800,
      height: 450,
      fit: "cover",
    });

    expect(Number.parseFloat(style.left) / 100 * 1080).toBeCloseTo(140, 10);
    expect(Number.parseFloat(style.top) / 100 * 1920).toBeCloseTo(600, 10);
    expect(Number.parseFloat(style.width) / 100 * 1080).toBeCloseTo(800, 10);
    expect(Number.parseFloat(style.height) / 100 * 1920).toBeCloseTo(450, 10);
  });

  it("keeps the saved comment attached to the video bottom in card previews", () => {
    const config = createDefaultTemplateConfig("comment-capture");
    expect(customCommentCanDockToVideo(config.video)).toBe(true);
    expect(customCommentLayerY(config)).toBe(config.video.y + config.video.height);
  });

  it("uses the saved free position when the video cannot accept docking", () => {
    const config = createDefaultTemplateConfig("comment-capture");
    config.video.y = 0;
    config.video.height = 600;
    config.comment.y = 1330;
    expect(customCommentCanDockToVideo(config.video)).toBe(false);
    expect(customCommentLayerY(config)).toBe(1330);
  });

  it("uses the same canvas contract for centered text and font sizes", () => {
    const config = createDefaultTemplateConfig();
    const style = customCenteredLayerStyle(config.title);

    expect(Number.parseFloat(style.left) / 100 * 1080).toBeCloseTo(config.title.x, 10);
    expect(Number.parseFloat(style.top) / 100 * 1920).toBeCloseTo(config.title.y, 10);
    expect(Number.parseFloat(style.width) / 100 * 1080).toBeCloseTo(config.title.maxWidth, 10);
    expect(Number.parseFloat(customCanvasWidth(config.title.fontSize)) / 100 * 1080)
      .toBeCloseTo(config.title.fontSize, 10);
  });
});
