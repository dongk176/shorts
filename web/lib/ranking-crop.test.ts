import { describe, expect, it } from "vitest";
import { rankingCropSize } from "./ranking-crop";
import { rankingDesign } from "./ranking-templates";

describe("ranking center cover crop", () => {
  it.each([[720, 1280], [1920, 1080], [1080, 1080], [0, 0]])("matches FFmpeg scale-to-cover for %sx%s", (width, height) => {
    const targetWidth = rankingDesign.layout.width;
    const targetHeight = rankingDesign.layout.height - rankingDesign.layout.headerHeight;
    const sourceWidth = width || 9;
    const sourceHeight = height || 16;
    const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
    const size = rankingCropSize(width, height);
    expect(parseFloat(size.width) * targetWidth / 100).toBeCloseTo(sourceWidth * scale);
    expect(parseFloat(size.height) * targetHeight / 100).toBeCloseTo(sourceHeight * scale);
  });
});
