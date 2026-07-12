import { describe, expect, it } from "vitest";
import { clipLengthRules, expectedShortCount } from "./contracts";

describe("clip rules", () => {
  it("keeps all user options inside 20–180 seconds", () => {
    expect(clipLengthRules).toEqual({
      sec_30: { min: 20, max: 30, target: 29 },
      sec_31_60: { min: 31, max: 60, target: 50 },
      sec_61_180: { min: 61, max: 180, target: 90 },
    });
  });

  it.each([
    [239, 3], [240, 5], [599, 5], [600, 8], [1199, 8],
    [1200, 10], [1799, 10], [1800, 12], [2699, 12], [2700, 15], [3600, 15],
  ])("maps source duration %s to %s shorts", (seconds, count) => {
    expect(expectedShortCount(seconds)).toBe(count);
  });
});
