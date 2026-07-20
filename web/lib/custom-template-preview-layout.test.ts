import { describe, expect, it } from "vitest";
import {
  customCanvasWidth,
  customCenteredLayerStyle,
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
