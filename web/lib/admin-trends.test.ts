import { describe, expect, it } from "vitest";
import {
  buildAdminTrend, clampTrendViewport, kstDate, shiftTrendDate,
  trendAxisLabel, trendStartDate, trendTickIndices, trendValueLabel, trendValueScale, zoomTrendViewport,
} from "./admin-trends";

describe("administrator daily trend ranges", () => {
  it("changes the day at Korean midnight, independent of the server timezone", () => {
    expect(kstDate(new Date("2026-09-04T14:59:59Z"))).toBe("2026-09-04");
    expect(kstDate(new Date("2026-09-04T15:00:00Z"))).toBe("2026-09-05");
    expect(shiftTrendDate("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("includes today and clamps six-month dates to the target month's end", () => {
    expect(trendStartDate("7d", "2026-09-05")).toBe("2026-08-30");
    expect(trendStartDate("30d", "2026-09-05")).toBe("2026-08-07");
    expect(trendStartDate("6m", "2026-09-05")).toBe("2026-03-05");
    expect(trendStartDate("6m", "2026-08-31")).toBe("2026-02-28");
    expect(trendStartDate("6m", "2024-08-31")).toBe("2024-02-29");
    expect(trendStartDate("6m", "2026-01-31")).toBe("2025-07-31");
  });

  it("zero-fills missing days without changing approved amounts or counts", () => {
    const data = buildAdminTrend("sales", "7d", "2026-09-05", [
      { date: "2026-08-29", value: 999, orderCount: 1 },
      { date: "2026-08-30", value: 20_000, orderCount: 2 },
      { date: "2026-09-05", value: 9_900, orderCount: 1 },
      { date: "2026-09-06", value: 999, orderCount: 1 },
    ]);
    expect(data.points).toHaveLength(7);
    expect(data.points.reduce((sum, point) => sum + point.value, 0)).toBe(29_900);
    expect(data.points[1]).toEqual({ date: "2026-08-31", value: 0, orderCount: 0 });
    expect(data.points.at(-1)?.date).toBe(data.to);
  });

  it("starts all-time at the metric's earliest record, handles empty and multi-year histories", () => {
    const data = buildAdminTrend("members", "all", "2026-09-05", [
      { date: "2026-09-05", value: 2 }, { date: "2021-01-01", value: 3 },
    ]);
    expect(data.from).toBe("2021-01-01");
    expect(data.points.length).toBeGreaterThan(2_000);
    expect(data.points.reduce((sum, point) => sum + point.value, 0)).toBe(5);
    expect(buildAdminTrend("members", "all", "2026-09-05", []).points)
      .toEqual([{ date: "2026-09-05", value: 0 }]);
    expect(buildAdminTrend("members", "30d", "2026-09-05", []).points).toHaveLength(30);
  });
});

describe("chart viewport and date collision prevention", () => {
  it("zooms around the center, clamps dragging and restores the full range", () => {
    expect(zoomTrendViewport({ start: 0, count: 30 }, 30, 0.5)).toEqual({ start: 8, count: 15 });
    expect(zoomTrendViewport({ start: 29, count: 2 }, 30, 0.5)).toEqual({ start: 28, count: 2 });
    expect(clampTrendViewport({ start: -500, count: 15 }, 30)).toEqual({ start: 0, count: 15 });
    expect(clampTrendViewport({ start: 500, count: 15 }, 30)).toEqual({ start: 15, count: 15 });
    expect(zoomTrendViewport({ start: 8, count: 15 }, 30, 2)).toEqual({ start: 0, count: 30 });
    expect(zoomTrendViewport({ start: 0, count: 1 }, 1, 0.5)).toEqual({ start: 0, count: 1 });
  });

  it.each([7, 14, 30, 185, 2_100])("keeps actual label bounds apart for %i daily points", (length) => {
    for (const plotWidth of [180, 280, 500, 1_200]) {
      for (const labelWidth of [36, 72]) {
        const widths = Array.from({ length }, (_, index) => labelWidth + index % 3);
        const ticks = trendTickIndices(widths, plotWidth);
        expect(ticks[0]).toBe(0);
        expect(ticks.at(-1)).toBe(length - 1);
        let previousRight = -14;
        for (const index of ticks) {
          const x = index / (length - 1) * plotWidth;
          const left = index === 0 ? x : index === length - 1 ? x - widths[index] : x - widths[index] / 2;
          const right = left + widths[index];
          expect(left - previousRight).toBeGreaterThanOrEqual(14);
          expect(right).toBeLessThanOrEqual(plotWidth);
          previousRight = right;
        }
      }
    }
  });

  it("handles tiny, empty and single-point charts and distinguishes years", () => {
    expect(trendTickIndices([72, 72], 100)).toEqual([1]);
    expect(trendTickIndices([], 300)).toEqual([]);
    expect(trendTickIndices([36], 300)).toEqual([0]);
    expect(trendAxisLabel("2026-09-05", false)).toBe("09.05");
    expect(trendAxisLabel("2025-09-05", true)).toBe("2025.09.05");
  });
});

describe("visible-range value axis", () => {
  it("rounds the visible maximum up to readable, evenly spaced ticks", () => {
    expect(trendValueScale(765_432)).toEqual({ maximum: 800_000, ticks: [0, 200_000, 400_000, 600_000, 800_000] });
    expect(trendValueScale(134)).toEqual({ maximum: 150, ticks: [0, 50, 100, 150] });
    expect(trendValueScale(2)).toEqual({ maximum: 2, ticks: [0, 1, 2] });
    expect(trendValueScale(0)).toEqual({ maximum: 1, ticks: [0, 1] });
  });

  it("recalculates after zooming and panning while keeping the zero baseline", () => {
    const points = [900_000, 70_000, 40_000, 30_000, 800_000];
    const axisFor = (start: number, count: number) => trendValueScale(Math.max(...points.slice(start, start + count)));
    expect(axisFor(0, 5).maximum).toBe(1_000_000);
    expect(axisFor(1, 3).maximum).toBe(80_000);
    expect(axisFor(2, 3).maximum).toBe(800_000);
    expect(axisFor(1, 3).ticks[0]).toBe(0);
  });

  it("uses won and member units, with compact labels for larger amounts", () => {
    expect(trendValueLabel(0, "sales")).toBe("0원");
    expect(trendValueLabel(2_000, "sales")).toBe("2,000원");
    expect(trendValueLabel(200_000, "sales")).toBe("20만원");
    expect(trendValueLabel(150_000_000, "sales")).toBe("1.5억원");
    expect(trendValueLabel(50, "members")).toBe("50명");
    expect(trendValueLabel(15_000, "members")).toBe("1.5만명");
  });
});
