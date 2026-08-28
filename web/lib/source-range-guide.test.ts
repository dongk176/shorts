import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SOURCE_RANGE_GUIDE_STORAGE_KEY,
  sourceRangeGuideSteps,
} from "./source-range-guide";

const shortsAppSource = readFileSync(
  new URL("../app/shorts-app.tsx", import.meta.url),
  "utf8",
);
const sourceRangeGuideSource = readFileSync(
  new URL("../components/source-range-guide.tsx", import.meta.url),
  "utf8",
);

describe("source range guide", () => {
  it("guides the start, end and charged usage before finishing", () => {
    expect(sourceRangeGuideSteps.map((step) => step.id)).toEqual([
      "start",
      "end",
      "usage",
      "complete",
    ]);
    expect(sourceRangeGuideSteps[0].targetSelector).toBe('[data-source-range-guide="start-handle"]');
    expect(sourceRangeGuideSteps[1].targetSelector).toBe('[data-source-range-guide="end-handle"]');
    expect(sourceRangeGuideSteps[0].scrollBlock).toBe("center");
    expect(sourceRangeGuideSteps[1].scrollBlock).toBe("center");
    expect(sourceRangeGuideSteps[2].description).toContain("선택한 구간의 길이만큼 사용량이 차감");
    expect(sourceRangeGuideSteps.at(-1)?.targetSelector).toBeNull();
  });

  it("uses a versioned dismissal key", () => {
    expect(SOURCE_RANGE_GUIDE_STORAGE_KEY).toBe("easycut:source-range-guide-dismissed:v2");
  });

  it("attaches the guide targets to the two slider handles", () => {
    expect(shortsAppSource).toContain('data-source-range-guide="start-handle"');
    expect(shortsAppSource).toContain('data-source-range-guide="end-handle"');
    expect(shortsAppSource).not.toContain('guideTarget="start"');
    expect(shortsAppSource).not.toContain('guideTarget="end"');
  });

  it("opens only after the first handle has finished scrolling into view", () => {
    expect(sourceRangeGuideSource).toContain('behavior: "smooth"');
    expect(sourceRangeGuideSource).toContain('window.addEventListener("scrollend"');
    expect(sourceRangeGuideSource).toContain("enabled={enabled && guideReady}");
  });

  it("uses a source player only on the isolated range-selection path", () => {
    expect(shortsAppSource).toContain("const sourceVideoEmbedUrl = !uploadSourceActive && sourceRangeSelectionEnabled && analysis");
    expect(shortsAppSource).toContain("youtubePrivacyEnhancedEmbedUrl(analysis.videoId)");
    expect(shortsAppSource).toContain("{sourceVideoEmbedUrl ? (");
    expect(shortsAppSource).toContain('<YoutubeThumbnail src={selectedSource.thumbnailUrl} alt="영상 썸네일"');
  });
});
