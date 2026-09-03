import type { Sql } from "postgres";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collectSearchVideoPages: vi.fn(),
  refreshReusableViewCounterSchedule: vi.fn(),
}));

vi.mock("@/lib/youtube-free", () => ({
  collectSearchVideoPages: mocks.collectSearchVideoPages,
  YoutubeFreeApiError: class YoutubeFreeApiError extends Error {},
}));
vi.mock("@/lib/reusable-view-counter-server", () => ({
  refreshReusableViewCounterSchedule: mocks.refreshReusableViewCounterSchedule,
}));

import {
  collectPopularSearchVideos,
  collectReusablePopularSearchVideos,
  POPULAR_REUSABLE_SEARCH_PAGE_LIMIT,
} from "./youtube-popular-search";

const baseVideo = {
  category: "gaming",
  title: "인기 영상",
  channelName: "인기 채널",
  thumbnailUrl: "https://example.com/thumb.jpg",
  durationSeconds: 600,
  viewCount: 1_000_000,
  publishedAt: "2026-07-25T00:00:00.000Z",
  isKorean: true,
  searchRank: 1,
  pageNumber: 1,
} as const;

function fakeDb() {
  const tx = vi.fn((first: unknown) => {
    if (Array.isArray(first) && typeof first[0] === "object") return {};
    const text = Array.isArray(first) ? first.join(" ") : "";
    if (text.includes("returning id, snapshot_date")) {
      return [{ id: "6d1eeef5-6dc0-4f30-8af6-a95f08e9719c", snapshotDate: "2026-07-25" }];
    }
    return [];
  });
  Object.assign(tx, {
    savepoint: vi.fn(async (
      _name: string,
      callback: (sql: typeof tx) => unknown,
    ) => callback(tx)),
  });
  const db = vi.fn(() => Promise.resolve([]));
  Object.assign(db, {
    begin: vi.fn(async (callback: (sql: typeof tx) => unknown) => callback(tx)),
  });
  return { db: db as unknown as Sql, tx };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.refreshReusableViewCounterSchedule.mockResolvedValue({});
});

describe("reusable popular search collection", () => {
  it("merges a dedicated Creative Commons category sweep into the accumulated snapshot", async () => {
    mocks.collectSearchVideoPages
      .mockResolvedValueOnce({
        pages: 2,
        nextPageToken: "general-next",
        items: [{ ...baseVideo, videoId: "generalVid1", license: "youtube" }],
      })
      .mockResolvedValueOnce({
        pages: 4,
        nextPageToken: "reusable-next",
        items: [
          { ...baseVideo, videoId: "creativeVid1", license: "creativeCommon" },
          { ...baseVideo, videoId: "wrongLicense1", license: "youtube" },
        ],
      });
    const { db } = fakeDb();

    const result = await collectPopularSearchVideos({
      db,
      now: new Date("2026-07-25T08:00:00.000Z"),
      maxPages: 2,
      reusableMaxPages: 4,
      requestIntervalMs: 0,
    });

    expect(mocks.collectSearchVideoPages).toHaveBeenCalledTimes(2);
    expect(mocks.collectSearchVideoPages.mock.calls[0][0]).toMatchObject({
      maxPages: 2,
    });
    const reusableOptions = mocks.collectSearchVideoPages.mock.calls[1][0];
    expect(reusableOptions).toMatchObject({
      maxPages: 4,
      videoLicense: "creativeCommon",
    });
    expect(reusableOptions.sources).toHaveLength(7);
    expect(new Set(reusableOptions.sources.map(
      (source: { videoCategoryId: string }) => source.videoCategoryId,
    ))).toEqual(new Set(["24", "20", "17", "10", "25", "28", "26"]));
    expect(reusableOptions.sources.every(
      (source: { publishedAfter: Date | null }) => source.publishedAfter === null,
    )).toBe(true);
    expect(result).toMatchObject({
      pages: 6,
      reusablePages: 4,
      items: 2,
      hasMoreOnYoutube: true,
    });
    expect(mocks.refreshReusableViewCounterSchedule).toHaveBeenCalledWith(
      expect.anything(),
      {
        runId: "6d1eeef5-6dc0-4f30-8af6-a95f08e9719c",
        updatedAt: new Date("2026-07-25T08:00:00.000Z"),
      },
    );
  });

  it("caps the reusable search lane to its daily quota budget", async () => {
    mocks.collectSearchVideoPages
      .mockResolvedValueOnce({ pages: 1, items: [] })
      .mockResolvedValueOnce({ pages: POPULAR_REUSABLE_SEARCH_PAGE_LIMIT, items: [] });
    const { db } = fakeDb();

    await collectPopularSearchVideos({
      db,
      maxPages: 1,
      reusableMaxPages: POPULAR_REUSABLE_SEARCH_PAGE_LIMIT + 50,
      requestIntervalMs: 0,
    });

    expect(mocks.collectSearchVideoPages.mock.calls[1][0].maxPages)
      .toBe(POPULAR_REUSABLE_SEARCH_PAGE_LIMIT);
  });

  it("writes a reusable-only snapshot without copying the general list", async () => {
    mocks.collectSearchVideoPages.mockResolvedValueOnce({
      pages: 4,
      items: [{ ...baseVideo, videoId: "creativeVid1", license: "creativeCommon" }],
    });
    const { db, tx } = fakeDb();

    const result = await collectReusablePopularSearchVideos({
      db,
      now: new Date("2026-07-25T13:00:00.000Z"),
      maxPages: 4,
      requestIntervalMs: 0,
    });

    expect(mocks.collectSearchVideoPages).toHaveBeenCalledOnce();
    expect(mocks.collectSearchVideoPages.mock.calls[0][0]).toMatchObject({
      maxPages: 4,
      videoLicense: "creativeCommon",
    });
    expect(tx.mock.calls.some((call) => {
      const first = call[0];
      return Array.isArray(first)
        && typeof first[0] === "string"
        && first.join(" ").includes("license <> 'creativeCommon'");
    })).toBe(false);
    expect(result).toMatchObject({
      pages: 4,
      items: 1,
      totalItems: 1,
    });
    expect(mocks.refreshReusableViewCounterSchedule).toHaveBeenCalledWith(
      expect.anything(),
      {
        runId: "6d1eeef5-6dc0-4f30-8af6-a95f08e9719c",
        updatedAt: new Date("2026-07-25T13:00:00.000Z"),
      },
    );
  });

  it("keeps a successful manual collection when the cosmetic counter refresh fails", async () => {
    mocks.collectSearchVideoPages.mockResolvedValueOnce({
      pages: 1,
      items: [{ ...baseVideo, videoId: "creativeVid1", license: "creativeCommon" }],
    });
    mocks.refreshReusableViewCounterSchedule.mockRejectedValueOnce(
      new Error("counter unavailable"),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db } = fakeDb();

    await expect(collectReusablePopularSearchVideos({
      db,
      now: new Date("2026-07-25T13:00:00.000Z"),
      maxPages: 1,
      requestIntervalMs: 0,
    })).resolves.toMatchObject({ items: 1 });
    expect(consoleError).toHaveBeenCalledWith(
      "reusable_view_counter_refresh_failed",
      expect.objectContaining({ errorName: "Error" }),
    );
    consoleError.mockRestore();
  });

  it("does not change the counter when reusable collection fails", async () => {
    mocks.collectSearchVideoPages.mockRejectedValueOnce(
      new Error("collection failed"),
    );
    const { db } = fakeDb();

    await expect(collectReusablePopularSearchVideos({
      db,
      now: new Date("2026-07-25T13:00:00.000Z"),
      maxPages: 1,
      requestIntervalMs: 0,
    })).rejects.toThrow("collection failed");
    expect(mocks.refreshReusableViewCounterSchedule).not.toHaveBeenCalled();
  });
});
