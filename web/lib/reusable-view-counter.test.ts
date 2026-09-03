import { describe, expect, it } from "vitest";
import {
  interpolateReusableViewCounterValue,
  nextDailyReusableCollectionAt,
  projectReusableViewCounter,
  REUSABLE_VIEW_COUNTER_INTERVAL_MS,
  reusableViewCounterChangeTimes,
  type ReusableViewCounterSchedule,
} from "./reusable-view-counter";

const schedule: ReusableViewCounterSchedule = {
  startValue: 800_000_000,
  targetValue: 838_399_347,
  startedAt: "2026-09-03T08:00:00.000Z",
  endsAt: "2026-09-04T08:00:00.000Z",
};

describe("reusable view counter schedule", () => {
  it("animates each scheduled increase smoothly without overshooting", () => {
    const values = Array.from({ length: 101 }, (_, index) =>
      interpolateReusableViewCounterValue(100_000, 200_000, index / 100));
    expect(values[0]).toBe(100_000);
    expect(values.at(-1)).toBe(200_000);
    expect(values[50]).toBeGreaterThan(150_000);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThanOrEqual(values[index - 1]);
      expect(values[index]).toBeLessThanOrEqual(200_000);
    }
  });

  it("uses a deterministic five-second sequence", () => {
    const first = reusableViewCounterChangeTimes(schedule);
    const second = reusableViewCounterChangeTimes(schedule);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(17_000);
    const boundaries = [Date.parse(schedule.startedAt), ...first];
    for (let index = 1; index < boundaries.length; index += 1) {
      const gap = boundaries[index] - boundaries[index - 1];
      expect(gap).toBe(REUSABLE_VIEW_COUNTER_INTERVAL_MS);
    }
    expect(first.at(-1)).toBe(Date.parse(schedule.endsAt));
  });

  it("uses only a shorter final boundary when the end time is not five-second aligned", () => {
    const unaligned = {
      ...schedule,
      startedAt: "2026-09-03T08:00:00.123Z",
    };
    const changes = reusableViewCounterChangeTimes(unaligned);
    const boundaries = [Date.parse(unaligned.startedAt), ...changes];
    const gaps = boundaries.slice(1).map((value, index) => value - boundaries[index]);
    expect(gaps.slice(0, -1).every(
      (gap) => gap === REUSABLE_VIEW_COUNTER_INTERVAL_MS,
    )).toBe(true);
    expect(gaps.at(-1)).toBeGreaterThan(0);
    expect(gaps.at(-1)).toBeLessThanOrEqual(REUSABLE_VIEW_COUNTER_INTERVAL_MS);
  });

  it("spreads increases evenly, never decreases, and reaches the exact target", () => {
    const changes = reusableViewCounterChangeTimes(schedule);
    const values = changes.map((at) =>
      projectReusableViewCounter(schedule, at, changes).value,
    );
    expect(values[0]).toBeGreaterThanOrEqual(schedule.startValue);
    expect(values.at(-1)).toBe(schedule.targetValue);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThanOrEqual(values[index - 1]);
      expect(values[index]).toBeLessThanOrEqual(schedule.targetValue);
    }
    const increments = values.map((value, index) =>
      value - (values[index - 1] ?? schedule.startValue),
    );
    expect(Math.max(...increments) - Math.min(...increments)).toBeLessThanOrEqual(1);
  });

  it("reconstructs the same value after a refresh at the same server time", () => {
    const at = Date.parse("2026-09-03T19:37:42.000Z");
    expect(projectReusableViewCounter(schedule, at)).toEqual(
      projectReusableViewCounter({ ...schedule }, at),
    );
  });

  it("lets a manual collection continue from the previously projected value", () => {
    const manualUpdateAt = Date.parse("2026-09-03T11:00:00.000Z");
    const previousValue = projectReusableViewCounter(schedule, manualUpdateAt).value;
    const nextSchedule: ReusableViewCounterSchedule = {
      startValue: previousValue,
      targetValue: 900_000_000,
      startedAt: new Date(manualUpdateAt).toISOString(),
      endsAt: "2026-09-04T08:00:00.000Z",
    };
    expect(projectReusableViewCounter(nextSchedule, manualUpdateAt).value)
      .toBe(previousValue);
    expect(projectReusableViewCounter(nextSchedule, Date.parse(nextSchedule.endsAt)).value)
      .toBe(nextSchedule.targetValue);
  });

  it("uses the next 17:00 KST boundary for daily and evening manual runs", () => {
    expect(nextDailyReusableCollectionAt(new Date("2026-09-03T08:00:00.000Z")).toISOString())
      .toBe("2026-09-04T08:00:00.000Z");
    expect(nextDailyReusableCollectionAt(new Date("2026-09-03T11:00:00.000Z")).toISOString())
      .toBe("2026-09-04T08:00:00.000Z");
    expect(nextDailyReusableCollectionAt(new Date("2026-09-03T07:00:00.000Z")).toISOString())
      .toBe("2026-09-03T08:00:00.000Z");
  });
});
