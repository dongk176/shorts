import type { Sql } from "postgres";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getPopularSearchVideos, getReusablePopularVideos } from "./youtube-popular-search";
import {
  getPopularVideos,
  getStoredPopularVideo,
} from "./youtube-popular";

const run = {
  id: "c6963d6a-270b-4ac6-a934-9eddf670c0dd",
  completedAt: new Date("2026-07-22T08:00:36.417Z"),
};

const reusableVideo = {
  videoId: "dQw4w9WgXcQ",
  category: "gaming",
  title: "재사용 허용 영상",
  channelName: "인기 채널",
  thumbnailUrl: "https://example.com/thumb.jpg",
  durationSeconds: 600,
  viewCount: 1_000_000,
  publishedAt: new Date("2026-07-22T00:00:00.000Z"),
  license: "creativeCommon",
  totalCount: 1,
  todayCount: 1,
  weekCount: 1,
  allCount: 1,
};

function sqlText(call: unknown[]) {
  return (call[0] as TemplateStringsArray).join(" ").replace(/\s+/g, " ");
}

describe("accumulated reusable popular videos", () => {
  it("deduplicates every ready trending snapshot and sorts by the latest sighting", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([run])
      .mockResolvedValueOnce([reusableVideo]);
    const result = await getPopularVideos(
      "trending",
      "all",
      true,
      false,
      false,
      undefined,
      48,
      "all",
      query as unknown as Sql,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      videoId: reusableVideo.videoId,
      license: "creativeCommon",
    });
    expect(query.mock.calls[0].slice(1)).toContain(true);
    const historyQuery = sqlText(query.mock.calls[1]);
    expect(historyQuery).toContain("join shorts_mvp.popular_video_runs");
    expect(historyQuery).toContain("partition by i.video_id");
    expect(historyQuery).toContain("i.license='creativeCommon'");
    expect(historyQuery).toContain("then last_seen_at end desc");
  });

  it("keeps the unfiltered trending list scoped to the current snapshot", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([run])
      .mockResolvedValueOnce([reusableVideo]);
    const result = await getPopularVideos(
      "trending",
      "all",
      false,
      false,
      false,
      undefined,
      48,
      "all",
      query as unknown as Sql,
    );

    expect(result.periodCounts).toEqual({ today: 1, week: 1, all: 1 });
    const currentQuery = sqlText(query.mock.calls[1]);
    expect(currentQuery).toContain("historical_candidates");
    expect(currentQuery).toContain("from shorts_mvp.popular_video_items current_item");
    expect(currentQuery).toContain("current_item.run_id=");
  });

  it("filters real-time trending videos by when they were first discovered", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([run])
      .mockResolvedValueOnce([{
        ...reusableVideo,
        todayCount: 7,
        weekCount: 31,
        allCount: 240,
      }]);

    const result = await getPopularVideos(
      "trending",
      "all",
      false,
      false,
      false,
      undefined,
      48,
      "today",
      query as unknown as Sql,
    );

    expect(result.totalCount).toBe(7);
    expect(result.periodCounts).toEqual({ today: 7, week: 31, all: 240 });
    const periodQuery = sqlText(query.mock.calls[1]);
    expect(periodQuery).toContain("min(r.completed_at) over (partition by i.video_id) as first_seen_at");
    expect(periodQuery).toContain("from shorts_mvp.popular_video_items current_item");
    expect(periodQuery).toContain("current_item.run_id=");
    expect(periodQuery).toContain("current_item.video_id=historical_candidates.video_id");
    expect(periodQuery).toContain("first_seen_at > run_window.previous_completed_at");
    expect(periodQuery).toContain("date_trunc('day', run_window.current_completed_at at time zone 'Asia/Seoul')");
    expect(query.mock.calls[1].slice(1)).toContain("today");
  });

  it("excludes CC videos when the chart snapshot is used as the view-count fallback", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([run])
      .mockResolvedValueOnce([{
        ...reusableVideo,
        videoId: "standardVid",
        license: "youtube",
      }]);

    await getPopularVideos(
      "views",
      "all",
      false,
      false,
      false,
      undefined,
      48,
      "all",
      query as unknown as Sql,
    );

    const fallbackQuery = sqlText(query.mock.calls[1]);
    expect(fallbackQuery).toContain("or i.license <> 'creativeCommon'");
    expect(query.mock.calls[1].slice(1)).toContain("views");
  });

  it("keeps every retained reusable fallback video regardless of view count", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([run])
      .mockResolvedValueOnce([reusableVideo]);

    await getPopularVideos(
      "views",
      "all",
      true,
      false,
      false,
      undefined,
      48,
      "all",
      query as unknown as Sql,
    );

    const fallbackQuery = sqlText(query.mock.calls[1]);
    expect(fallbackQuery).not.toContain("view_count >");
  });

  it("allows a retained reusable trending video to open after its snapshot expires", async () => {
    const query = vi.fn().mockResolvedValueOnce([reusableVideo]);
    await expect(
      getStoredPopularVideo(reusableVideo.videoId, query as unknown as Sql),
    ).resolves.toMatchObject({ videoId: reusableVideo.videoId });

    const storedQuery = sqlText(query.mock.calls[0]);
    expect(storedQuery).toContain("r.expires_at > now() or i.license='creativeCommon'");
  });

  it("deduplicates every ready view-count snapshot and sorts by views across history", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([run])
      .mockResolvedValueOnce([reusableVideo]);
    const result = await getPopularSearchVideos(
      "all",
      true,
      false,
      false,
      undefined,
      48,
      "all",
      query as unknown as Sql,
    );

    expect(result.items).toHaveLength(1);
    const historyQuery = sqlText(query.mock.calls[1]);
    expect(historyQuery).toContain("join shorts_mvp.popular_search_runs");
    expect(historyQuery).toContain("partition by i.video_id");
    expect(historyQuery).toContain("i.license='creativeCommon'");
    expect(historyQuery).toContain("view_count desc, last_seen_at desc");
    expect(historyQuery).toContain("where current_run.id=");
    expect(query.mock.calls[1].slice(1)).toContain(run.id);
    expect(query.mock.calls[1].slice(1)).not.toContain(run.completedAt.toISOString());
  });

  it("skips reusable-only snapshots and excludes CC videos from the general view list", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([run])
      .mockResolvedValueOnce([{
        ...reusableVideo,
        videoId: "standardVid",
        license: "youtube",
      }]);

    const result = await getPopularSearchVideos(
      "all",
      false,
      false,
      false,
      undefined,
      48,
      "all",
      query as unknown as Sql,
    );

    expect(result.items).toHaveLength(1);
    const runQuery = sqlText(query.mock.calls[0]);
    expect(runQuery).toContain("exists ( select 1 from shorts_mvp.popular_search_items");
    expect(runQuery).toContain("i.license <> 'creativeCommon'");
    expect(query.mock.calls[0].slice(1)).toContain(true);
    const currentQuery = sqlText(query.mock.calls[1]);
    expect(currentQuery).toContain("license <> 'creativeCommon'");
  });

  it("filters view-count videos by the seven-day discovery window", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([run])
      .mockResolvedValueOnce([{
        ...reusableVideo,
        license: "youtube",
        todayCount: 5,
        weekCount: 22,
        allCount: 180,
      }]);

    const result = await getPopularSearchVideos(
      "all",
      false,
      false,
      false,
      undefined,
      48,
      "week",
      query as unknown as Sql,
    );

    expect(result.totalCount).toBe(22);
    expect(result.periodCounts).toEqual({ today: 5, week: 22, all: 180 });
    const periodQuery = sqlText(query.mock.calls[1]);
    expect(periodQuery).toContain("join shorts_mvp.popular_search_runs");
    expect(periodQuery).toContain("min(r.completed_at) over (partition by i.video_id) as first_seen_at");
    expect(periodQuery).toContain("from shorts_mvp.popular_search_items current_item");
    expect(periodQuery).toContain("current_item.run_id=");
    expect(periodQuery).toContain("current_item.video_id=historical_candidates.video_id");
    expect(periodQuery).toContain("first_seen_at > run_window.previous_completed_at");
    expect(query.mock.calls[1].slice(1)).toContain("week");
  });

  it("combines reusable videos from real-time and view-count snapshots", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([run])
      .mockResolvedValueOnce([reusableVideo]);

    const result = await getReusablePopularVideos(
      "all",
      false,
      false,
      undefined,
      48,
      "all",
      query as unknown as Sql,
    );

    expect(result.items).toHaveLength(1);
    expect(result.reusablePeriodCounts).toEqual({ today: 1, week: 1, all: 1 });
    const combinedQuery = sqlText(query.mock.calls[1]);
    expect(combinedQuery).toContain("from shorts_mvp.popular_search_items");
    expect(combinedQuery).toContain("join shorts_mvp.popular_search_runs");
    expect(combinedQuery).toContain("union all");
    expect(combinedQuery).toContain("from shorts_mvp.popular_video_items");
    expect(combinedQuery).toContain("join shorts_mvp.popular_video_runs");
    expect(combinedQuery).toContain("partition by video_id");
    expect(combinedQuery).toContain("min(last_seen_at) over (partition by video_id) as first_seen_at");
    expect(combinedQuery).toContain("current_run.completed_at as current_completed_at");
    expect(combinedQuery).toContain("previous_run.completed_at < current_run.completed_at");
    expect(combinedQuery).toContain("first_seen_at > run_window.previous_completed_at");
    expect(combinedQuery).toContain(
      "date_trunc('day', run_window.current_completed_at at time zone 'Asia/Seoul')",
    );
    expect(combinedQuery).not.toContain("date_trunc('day', now()");
    expect(combinedQuery).toContain("count(*) as all_count");
    expect(combinedQuery).not.toContain("view_count >");
    expect(combinedQuery).toContain("case when");
    expect(combinedQuery).toContain("then first_seen_at end desc");
    expect(query.mock.calls[1].slice(1).filter((value) => value === run.id)).toHaveLength(1);
    expect(query.mock.calls[1].slice(1)).not.toContain(run.completedAt.toISOString());
  });

  it("returns period counts even when the selected reusable period is empty", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([run])
      .mockResolvedValueOnce([{
        videoId: null,
        todayCount: 0,
        weekCount: 81,
        allCount: 769,
      }]);

    const result = await getReusablePopularVideos(
      "all",
      false,
      false,
      undefined,
      48,
      "today",
      query as unknown as Sql,
    );

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.reusablePeriodCounts).toEqual({
      today: 0,
      week: 81,
      all: 769,
    });
    expect(result.nextCursor).toBeUndefined();
  });
});
