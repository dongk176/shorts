import { describe, expect, it } from "vitest";
import {
  SOURCE_RANGE_GUIDE_STORAGE_KEY,
  sourceRangeGuideSteps,
} from "./source-range-guide";

describe("source range guide", () => {
  it("guides the start, end and charged usage before finishing", () => {
    expect(sourceRangeGuideSteps.map((step) => step.id)).toEqual([
      "start",
      "end",
      "usage",
      "complete",
    ]);
    expect(sourceRangeGuideSteps[0].targetSelector).toBe('[data-source-range-guide="start"]');
    expect(sourceRangeGuideSteps[1].targetSelector).toBe('[data-source-range-guide="end"]');
    expect(sourceRangeGuideSteps[2].description).toContain("선택한 구간의 길이만큼 사용량이 차감");
    expect(sourceRangeGuideSteps.at(-1)?.targetSelector).toBeNull();
  });

  it("uses a versioned dismissal key", () => {
    expect(SOURCE_RANGE_GUIDE_STORAGE_KEY).toBe("easycut:source-range-guide-dismissed:v1");
  });
});
