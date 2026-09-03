import type { Sql } from "postgres";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  getPublicSiteMetrics,
  refreshReusableViewCounterSchedule,
} from "./reusable-view-counter-server";
import { projectReusableViewCounter } from "./reusable-view-counter";

function sqlText(first: unknown) {
  return Array.isArray(first) && typeof first[0] === "string"
    ? first.join(" ")
    : "";
}

function fakeDb(options: {
  metrics?: Array<{ key: string; value: string }>;
  aggregate?: Record<string, unknown>;
}) {
  return vi.fn((first: unknown) => {
    if (Array.isArray(first) && typeof first[0] !== "string") return {};
    const text = sqlText(first);
    if (text.includes("from shorts_mvp.site_metrics")) {
      return Promise.resolve(options.metrics || []);
    }
    if (text.includes("with run_window as")) {
      return Promise.resolve(options.aggregate ? [options.aggregate] : []);
    }
    return Promise.resolve([]);
  }) as unknown as Sql;
}

describe("reusable view counter persistence", () => {
  it("reads the generated count and complete counter schedule in one query", async () => {
    const db = fakeDb({
      metrics: [
        { key: "generated_shorts", value: "53731" },
        { key: "reusable_views_start", value: "800000000" },
        { key: "reusable_views_target", value: "838399347" },
        { key: "reusable_views_started_at_ms", value: "1788422400000" },
        { key: "reusable_views_ends_at_ms", value: "1788508800000" },
      ],
    });

    await expect(getPublicSiteMetrics(db)).resolves.toEqual({
      generatedShortCount: 53_731,
      reusableViewCounter: {
        startValue: 800_000_000,
        targetValue: 838_399_347,
        startedAt: "2026-09-03T08:00:00.000Z",
        endsAt: "2026-09-04T08:00:00.000Z",
      },
    });
    expect(db).toHaveBeenCalledTimes(2);
  });

  it("keeps the counter unavailable when any persisted schedule value is missing", async () => {
    const db = fakeDb({
      metrics: [
        { key: "generated_shorts", value: "53731" },
        { key: "reusable_views_target", value: "838399347" },
      ],
    });
    await expect(getPublicSiteMetrics(db)).resolves.toEqual({
      generatedShortCount: 53_731,
      reusableViewCounter: null,
    });
  });

  it("bootstraps from the target minus newly discovered reusable views", async () => {
    const now = new Date("2026-09-03T08:00:00.000Z");
    const db = fakeDb({
      aggregate: {
        currentCompletedAt: now,
        previousCompletedAt: new Date("2026-09-02T08:00:00.000Z"),
        targetValue: "838399347",
        newlyDiscoveredViews: "38399347",
      },
    });

    await expect(refreshReusableViewCounterSchedule(db, {
      runId: "6d1eeef5-6dc0-4f30-8af6-a95f08e9719c",
      updatedAt: now,
    })).resolves.toEqual({
      startValue: 800_000_000,
      targetValue: 838_399_347,
      startedAt: "2026-09-03T08:00:00.000Z",
      endsAt: "2026-09-04T08:00:00.000Z",
    });

    const calls = (db as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const aggregateSql = calls.map(([first]) => sqlText(first)).find((text) =>
      text.includes("with run_window as"),
    );
    expect(aggregateSql).toContain("shorts_mvp.popular_search_items");
    expect(aggregateSql).toContain("shorts_mvp.popular_video_items");
    expect(aggregateSql).toContain("i.license='creativeCommon'");
    const insertCall = calls.find(([first]) => sqlText(first).includes("insert into shorts_mvp.site_metrics"));
    expect(insertCall).toBeDefined();
    expect(insertCall).toContain(800_000_000);
    expect(insertCall).toContain(838_399_347);
  });

  it("continues a manual refresh from the previously projected display value", async () => {
    const existing = {
      startValue: 800_000_000,
      targetValue: 838_399_347,
      startedAt: "2026-09-03T08:00:00.000Z",
      endsAt: "2026-09-04T08:00:00.000Z",
    };
    const manualTime = new Date("2026-09-03T11:00:00.000Z");
    const projected = projectReusableViewCounter(existing, manualTime.getTime()).value;
    const db = fakeDb({
      metrics: [
        { key: "reusable_views_start", value: String(existing.startValue) },
        { key: "reusable_views_target", value: String(existing.targetValue) },
        { key: "reusable_views_started_at_ms", value: String(Date.parse(existing.startedAt)) },
        { key: "reusable_views_ends_at_ms", value: String(Date.parse(existing.endsAt)) },
      ],
      aggregate: {
        currentCompletedAt: manualTime,
        previousCompletedAt: new Date(existing.startedAt),
        targetValue: "900000000",
        newlyDiscoveredViews: "61600653",
      },
    });

    const result = await refreshReusableViewCounterSchedule(db, {
      runId: "6d1eeef5-6dc0-4f30-8af6-a95f08e9719c",
      updatedAt: manualTime,
    });
    expect(result.startValue).toBe(projected);
    expect(result.targetValue).toBe(900_000_000);
    expect(result.endsAt).toBe("2026-09-04T08:00:00.000Z");
  });
});
