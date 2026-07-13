import { describe, expect, it } from "vitest";
import {
  AI_CLIP_MAX_SECONDS,
  AI_CLIP_MIN_SECONDS,
  expectedShortCount,
  jobDeadlineMinutes,
} from "./contracts";

describe("clip rules", () => {
  it("uses the fixed AI-selected duration range", () => {
    expect([AI_CLIP_MIN_SECONDS, AI_CLIP_MAX_SECONDS]).toEqual([30, 60]);
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
});
