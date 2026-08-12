import { describe, expect, it } from "vitest";
import {
  AI_CLIP_MAX_SECONDS,
  AI_CLIP_MIN_SECONDS,
  expectedShortCount,
  jobDeadlineMinutes,
  sourceRangeJobDeadlineMinutes,
  videoAspectRatioOptions,
  videoAspectRatios,
} from "./contracts";

describe("clip rules", () => {
  it("defines the five supported video-region ratios and render sizes", () => {
    expect(videoAspectRatios).toEqual(["16:9", "5:4", "1:1", "4:5", "9:16"]);
    expect(videoAspectRatioOptions.map(({ value, width, height }) => [value, width, height])).toEqual([
      ["16:9", 1080, 608],
      ["5:4", 1080, 864],
      ["1:1", 1080, 1080],
      ["4:5", 1080, 1350],
      ["9:16", 1080, 1920],
    ]);
  });

  it("uses the fixed AI-selected duration range", () => {
    expect([AI_CLIP_MIN_SECONDS, AI_CLIP_MAX_SECONDS]).toEqual([30, 120]);
  });

  it.each([
    [239, 3], [240, 5], [599, 5], [600, 8], [1199, 8],
    [1200, 10], [1799, 10], [1800, 12], [2699, 12], [2700, 15], [3600, 15],
  ])("maps source duration %s to %s shorts", (seconds, count) => {
    expect(expectedShortCount(seconds)).toBe(count);
  });

  it.each([[30, 31], [600, 40], [1800, 60], [3600, 90]])(
    "gives %s seconds a %s minute processing deadline",
    (seconds, minutes) => {
      expect(jobDeadlineMinutes(seconds)).toBe(minutes);
    },
  );

  it.each([[3600, 90], [3601, 91], [10_800, 210], [14_400, 270]])(
    "gives a %s second range-source a %s minute deadline",
    (seconds, minutes) => {
      expect(sourceRangeJobDeadlineMinutes(seconds)).toBe(minutes);
    },
  );

  it("rejects range-source deadlines above four hours", () => {
    expect(() => sourceRangeJobDeadlineMinutes(14_400.001)).toThrow("구간 선택");
  });
});
