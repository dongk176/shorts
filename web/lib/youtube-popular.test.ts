import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectPopularCategory,
  POPULAR_VIDEO_CATEGORY_PAGE_LIMIT,
  popularVideoSourceCategories,
  YoutubePopularApiError,
} from "./youtube-popular";

const gaming = popularVideoSourceCategories.find((category) => category.value === "gaming")!;

function video(overrides: Record<string, unknown> = {}) {
  return {
    id: "dQw4w9WgXcQ",
    snippet: {
      title: "인기 영상",
      channelTitle: "인기 채널",
      publishedAt: "2026-07-14T00:00:00.000Z",
      liveBroadcastContent: "none",
      thumbnails: { high: { url: "https://example.com/high.jpg" } },
    },
    contentDetails: { duration: "PT1M" },
    statistics: { viewCount: "1000" },
    status: { privacyStatus: "public", license: "youtube" },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  process.env.YOUTUBE_API_KEY = "test-youtube-key";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.YOUTUBE_API_KEY;
});

describe("popular YouTube category collection", () => {
  it("follows every nextPageToken until YouTube omits it", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        nextPageToken: "page-2",
        items: [video()],
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [video({ id: "9bZkp7q19f0" })],
      }));

    const result = await collectPopularCategory(gaming, fetchMock);

    expect(result.pages).toBe(2);
    expect(result.items.map((item) => item.videoId)).toEqual(["dQw4w9WgXcQ", "9bZkp7q19f0"]);
    const first = new URL(String(fetchMock.mock.calls[0][0]));
    const second = new URL(String(fetchMock.mock.calls[1][0]));
    expect(first.searchParams.get("chart")).toBe("mostPopular");
    expect(first.searchParams.get("regionCode")).toBe("KR");
    expect(first.searchParams.get("videoCategoryId")).toBe("20");
    expect(first.searchParams.get("maxResults")).toBe("50");
    expect(first.searchParams.get("pageToken")).toBeNull();
    expect(second.searchParams.get("pageToken")).toBe("page-2");
  });

  it("limits each category to 15 API calls even when more pages remain", async () => {
    let page = 0;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      page += 1;
      return jsonResponse({ nextPageToken: `page-${page + 1}`, items: [] });
    });

    const result = await collectPopularCategory(gaming, fetchMock);

    expect(result.pages).toBe(POPULAR_VIDEO_CATEGORY_PAGE_LIMIT);
    expect(fetchMock).toHaveBeenCalledTimes(POPULAR_VIDEO_CATEGORY_PAGE_LIMIT);
    const lastRequest = new URL(String(fetchMock.mock.calls[POPULAR_VIDEO_CATEGORY_PAGE_LIMIT - 1][0]));
    expect(lastRequest.searchParams.get("pageToken")).toBe("page-15");
  });

  it("keeps videos regardless of duration and normalizes metadata", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      items: [video({
        contentDetails: { duration: "PT42S" },
        status: { privacyStatus: "public", license: "creativeCommon" },
      })],
    }));

    const result = await collectPopularCategory(gaming, fetchMock);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      durationSeconds: 42,
      license: "creativeCommon",
      category: "gaming",
      categoryRank: 1,
      pageNumber: 1,
      isKorean: true,
    });
  });

  it("excludes live, non-public, and incomplete videos", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      items: [
        video({ id: "liveVideo01", snippet: { ...video().snippet, liveBroadcastContent: "live" } }),
        video({ id: "privateVid1", status: { privacyStatus: "private", license: "youtube" } }),
        video({ id: "missingView1", statistics: {} }),
        video({ id: "validVideo1" }),
      ],
    }));

    const result = await collectPopularCategory(gaming, fetchMock);

    expect(result.items.map((item) => item.videoId)).toEqual(["validVideo1"]);
  });

  it("fails closed if YouTube repeats a page token", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ nextPageToken: "same-token", items: [] }))
      .mockResolvedValueOnce(jsonResponse({ nextPageToken: "same-token", items: [] }));

    await expect(collectPopularCategory(gaming, fetchMock)).rejects.toThrow("페이지 토큰이 반복");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns an understandable error when the API key is missing", async () => {
    delete process.env.YOUTUBE_API_KEY;

    await expect(collectPopularCategory(gaming, vi.fn<typeof fetch>())).rejects.toBeInstanceOf(YoutubePopularApiError);
  });

  it("records an empty category when YouTube has no regional popular chart", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 404));

    const result = await collectPopularCategory(gaming, fetchMock);

    expect(result).toEqual({ category: "gaming", pages: 1, items: [] });
  });

  it("never logs the API key when YouTube rejects a request", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 403));

    await expect(collectPopularCategory(gaming, fetchMock)).rejects.toBeInstanceOf(YoutubePopularApiError);

    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("test-youtube-key");
    expect(errorSpy).toHaveBeenCalledWith(
      "YouTube popular collection request failed",
      { category: "gaming", status: 403 },
    );
  });
});
