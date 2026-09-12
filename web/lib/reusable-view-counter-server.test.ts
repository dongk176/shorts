import type { Sql } from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  getPublicSiteMetrics,
  refreshCatalogViewCounter,
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
    if (text.includes("with run_window as") || text.includes("from shorts_mvp.youtube_catalog c")) {
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

describe("catalog view counter animation", () => {
  afterEach(() => vi.unstubAllEnvs());
  const existing = {
    startValue: 1_000_000,
    targetValue: 1_086_400,
    startedAt: "2026-09-12T00:00:00.000Z",
    endsAt: "2026-09-12T12:00:00.000Z",
  };
  function catalogDb(total: string, schedule: typeof existing | null = existing) {
    vi.stubEnv("YOUTUBE_DISCOVERY_ENABLED", "true");
    vi.stubEnv("YOUTUBE_CATALOG_READS_ENABLED", "true");
    return fakeDb({
      metrics: schedule ? [
        { key: "reusable_views_start", value: String(schedule.startValue) },
        { key: "reusable_views_target", value: String(schedule.targetValue) },
        { key: "reusable_views_started_at_ms", value: String(Date.parse(schedule.startedAt)) },
        { key: "reusable_views_ends_at_ms", value: String(Date.parse(schedule.endsAt)) },
      ] : [],
      aggregate: { total },
    });
  }
  function writes(db: Sql) {
    return (db as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter(([first]) => sqlText(first).includes("insert into shorts_mvp.site_metrics"));
  }

  it("restores five-second increases from the flat counter saved by the old catalog", async () => {
    const db = catalogDb("1100000", { ...existing, targetValue: existing.startValue });
    const now = new Date("2026-09-12T06:00:00Z");
    const schedule = await refreshCatalogViewCounter(db, now);
    expect(schedule).toMatchObject({ startValue: 1_000_000, targetValue: 1_100_000 });
    expect(projectReusableViewCounter(schedule!, now.getTime() + 5_000).value).toBeGreaterThan(1_000_000);
    expect(writes(db)[0]).toContain(1_000_000);
    expect(writes(db)[0]).toContain(1_100_000);
  });

  it("continues from the displayed count and retains the deadline when the total grows again", async () => {
    const db = catalogDb("1200000");
    const now = new Date("2026-09-12T06:00:00Z");
    const schedule = await refreshCatalogViewCounter(db, now);
    expect(schedule).toEqual({
      startValue: projectReusableViewCounter(existing, now.getTime()).value,
      targetValue: 1_200_000,
      startedAt: now.toISOString(),
      endsAt: existing.endsAt,
    });
  });

  it.each(["2026-09-12T06:00:00Z", "2026-09-13T06:00:00Z"])("keeps an unchanged target without restarting the animation at %s", async (time) => {
    const db = catalogDb(String(existing.targetValue));
    expect(await refreshCatalogViewCounter(db, new Date(time))).toEqual(existing);
    expect(writes(db)).toHaveLength(0);
  });

  it("immediately removes views below the displayed count", async () => {
    const db = catalogDb("800000");
    const now = new Date("2026-09-12T06:00:00Z");
    const schedule = await refreshCatalogViewCounter(db, now);
    expect(schedule).toMatchObject({ startValue: 800_000, targetValue: 800_000 });
    expect(projectReusableViewCounter(schedule!, now.getTime()).value).toBe(800_000);
  });

  it("caps remaining animation at a reduced total that is still above the displayed count", async () => {
    const db = catalogDb("1060000");
    const now = new Date("2026-09-12T06:00:00Z");
    const schedule = await refreshCatalogViewCounter(db, now);
    expect(schedule?.startValue).toBe(1_043_200);
    expect(projectReusableViewCounter(schedule!, Date.parse(existing.endsAt)).value).toBe(1_060_000);
  });

  it("starts a new twelve-hour window after the previous increase has finished", async () => {
    const db = catalogDb("1200000");
    expect(await refreshCatalogViewCounter(db, new Date("2026-09-13T06:00:00Z"))).toMatchObject({
      startValue: existing.targetValue,
      endsAt: "2026-09-13T18:00:00.000Z",
    });
  });

  it("uses the actual total on first collection without inventing a starting count", async () => {
    const db = catalogDb("1200000", null);
    expect(await refreshCatalogViewCounter(db, new Date(existing.startedAt))).toMatchObject({ startValue: 1_200_000, targetValue: 1_200_000 });
  });

  it("leaves legacy metrics untouched when catalog reads are off", async () => {
    const db = catalogDb("1200000");
    vi.stubEnv("YOUTUBE_CATALOG_READS_ENABLED", "false");
    await refreshCatalogViewCounter(db, new Date());
    expect(db).not.toHaveBeenCalled();
  });

  it.each(["-1", "NaN", "9007199254740992"])("does not overwrite the last good schedule with invalid total %s", async (total) => {
    const db = catalogDb(total);
    await expect(refreshCatalogViewCounter(db, new Date())).rejects.toThrow("REUSABLE_VIEW_COUNTER_VALUE_OUT_OF_RANGE");
    expect(writes(db)).toHaveLength(0);
  });
});
