import { describe, expect, it } from "vitest";
import {
  estimatedCreationMinutes,
  estimatedProgress,
  estimatedProgressWithFloor,
  estimatedRemainingLabel,
  estimatedRemainingMinutes,
  estimatedRerenderMinutes,
  SIMULATED_PROGRESS_START,
} from "./creation-progress";

describe("estimated creation progress", () => {
  it("uses one percent from the first render", () => {
    expect(SIMULATED_PROGRESS_START).toBe(1);
  });

  it.each([
    [5 * 60, 5],
    [10 * 60, 6],
    [20 * 60, 8],
    [30 * 60, 10],
    [45 * 60, 12],
    [60 * 60, 15],
  ])("maps a %s-second source to about %s minutes", (seconds, minutes) => {
    expect(estimatedCreationMinutes(seconds)).toBe(minutes);
  });

  it("moves continuously from one to ninety-nine percent over the estimate", () => {
    const startedAt = Date.UTC(2026, 6, 20, 0, 0, 0);
    expect(estimatedProgress(startedAt, startedAt, 8)).toBe(1);
    expect(estimatedProgress(startedAt, startedAt + 4 * 60_000, 8)).toBe(50);
    expect(estimatedProgress(startedAt, startedAt + 8 * 60_000, 8)).toBe(99);
    expect(estimatedProgress(startedAt, startedAt + 20 * 60_000, 8)).toBe(99);
  });

  it("never displays less than the persisted rerender progress", () => {
    expect(estimatedProgressWithFloor(1, 28)).toBe(28);
    expect(estimatedProgressWithFloor(47, 28)).toBe(47);
    expect(estimatedProgressWithFloor(1, Number.NaN)).toBe(1);
    expect(estimatedProgressWithFloor(120, 100)).toBe(99);
  });

  it("derives the remaining time from elapsed time", () => {
    const startedAt = Date.UTC(2026, 6, 20, 0, 0, 0);
    expect(estimatedRemainingMinutes(startedAt, startedAt, 8)).toBe(8);
    expect(estimatedRemainingMinutes(startedAt, startedAt + 61_000, 8)).toBe(7);
    expect(estimatedRemainingMinutes(startedAt, startedAt + 8 * 60_000, 8)).toBe(0);
  });

  it("switches the time label to finishing after the estimate", () => {
    expect(estimatedRemainingLabel(8)).toBe("약 8분 남음");
    expect(estimatedRemainingLabel(1)).toBe("약 1분 남음");
    expect(estimatedRemainingLabel(0)).toBe("마무리 중");
  });

  it.each([[30, 1], [60, 2]])(
    "maps a %s-second rerender to about %s minutes",
    (seconds, minutes) => {
      expect(estimatedRerenderMinutes(seconds)).toBe(minutes);
    },
  );
});
