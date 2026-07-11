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
    [239, 1], [240, 2], [599, 2], [600, 3], [1199, 3],
    [1200, 4], [2099, 4], [2100, 5], [3600, 5],
  ])("maps source duration %s to %s shorts", (seconds, count) => {
    expect(expectedShortCount(seconds)).toBe(count);
  });
});
