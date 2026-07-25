import type { Sql } from "postgres";
import { describe, expect, it, vi } from "vitest";
import { getPopularSearchVideos } from "./youtube-popular-search";
import { getPopularVideos, getStoredPopularVideo } from "./youtube-popular";

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
    expect(historyQuery).toContain("order by last_seen_at desc");
  });

  it("keeps the unfiltered trending list scoped to the current snapshot", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([run])
      .mockResolvedValueOnce([reusableVideo]);
    await getPopularVideos(
      "trending",
      "all",
      false,
      false,
      false,
      undefined,
      48,
      query as unknown as Sql,
    );

    const currentQuery = sqlText(query.mock.calls[1]);
    expect(currentQuery).toContain("where run_id=");
    expect(currentQuery).not.toContain("historical_candidates");
  });

  it("allows a retained reusable trending video to open after its snapshot expires", async () => {
    const query = vi.fn().mockResolvedValueOnce([reusableVideo]);
    await expect(
      getStoredPopularVideo(reusableVideo.videoId, query as unknown as Sql),
    ).resolves.toMatchObject({ videoId: reusableVideo.videoId });

    const storedQuery = sqlText(query.mock.calls[0]);
    expect(storedQuery).toContain("r.expires_at > now() or i.license='creativeCommon'");
  });

  it("deduplicates every ready view-count snapshot and sorts by the latest sighting", async () => {
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
      query as unknown as Sql,
    );

    expect(result.items).toHaveLength(1);
    const historyQuery = sqlText(query.mock.calls[1]);
    expect(historyQuery).toContain("join shorts_mvp.popular_search_runs");
    expect(historyQuery).toContain("partition by i.video_id");
    expect(historyQuery).toContain("i.license='creativeCommon'");
    expect(historyQuery).toContain("order by last_seen_at desc");
  });
});
