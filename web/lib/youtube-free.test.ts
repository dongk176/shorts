import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectSearchVideoPages, YoutubeFreeApiError } from "./youtube-free";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function detail(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    snippet: {
      title: `인기 영상 ${id}`,
      channelTitle: "인기 채널",
      categoryId: "20",
      publishedAt: "2026-07-14T00:00:00.000Z",
      liveBroadcastContent: "none",
      thumbnails: { high: { url: `https://example.com/${id}.jpg` } },
    },
    contentDetails: { duration: "PT12M34S" },
    statistics: { viewCount: "100000" },
    status: { privacyStatus: "public", license: "youtube", embeddable: true },
    ...overrides,
  };
}

beforeEach(() => {
  process.env.YOUTUBE_API_KEY = "test-youtube-key";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.YOUTUBE_API_KEY;
});

describe("free YouTube search collection", () => {
  it("uses one search page with the agreed filters and one detail request", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        nextPageToken: "page-2",
        items: [
          { id: { videoId: "dQw4w9WgXcQ" } },
          { id: { videoId: "9bZkp7q19f0" } },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [detail("9bZkp7q19f0"), detail("dQw4w9WgXcQ")],
      }));

    const result = await collectSearchVideoPages({
      maxPages: 1,
      now: new Date("2026-07-15T00:00:00.000Z"),
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const searchUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(searchUrl.pathname).toBe("/youtube/v3/search");
    expect(Object.fromEntries(searchUrl.searchParams)).toMatchObject({
      type: "video",
      q: "엔터테인먼트",
      order: "viewCount",
      publishedAfter: "2026-07-08T00:00:00.000Z",
      regionCode: "KR",
      relevanceLanguage: "ko",
      videoDuration: "any",
      safeSearch: "moderate",
      maxResults: "50",
    });
    const detailUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(detailUrl.pathname).toBe("/youtube/v3/videos");
    expect(detailUrl.searchParams.get("id")).toBe("dQw4w9WgXcQ,9bZkp7q19f0");
    expect(result.pages).toBe(1);
    expect(result.nextPageToken).toBe("page-2");
    expect(result.items.map((item) => item.videoId)).toEqual(["dQw4w9WgXcQ", "9bZkp7q19f0"]);
  });

  it("spreads collection pages across topic queries before requesting next pages", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    for (let index = 0; index < 3; index += 1) {
      const videoId = `topicVideo${index}`;
      fetchMock
        .mockResolvedValueOnce(jsonResponse({
          nextPageToken: `next-${index}`,
          items: [{ id: { videoId } }],
        }))
        .mockResolvedValueOnce(jsonResponse({ items: [detail(videoId)] }));
    }

    const result = await collectSearchVideoPages({ maxPages: 3, fetchImpl: fetchMock });

    const searchQueries = [0, 2, 4].map((callIndex) =>
      new URL(String(fetchMock.mock.calls[callIndex][0])).searchParams.get("q"),
    );
    expect(searchQueries).toEqual(["엔터테인먼트", "예능", "게임"]);
    expect(result.pages).toBe(3);
    expect(result.items).toHaveLength(3);
  });

  it("excludes live, private, and incomplete details", async () => {
    const ids = ["liveVideo01", "privateVid1", "noEmbedVid1", "missingView1", "validVideo1"];
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: ids.map((videoId) => ({ id: { videoId } })) }))
      .mockResolvedValueOnce(jsonResponse({ items: [
        detail("liveVideo01", { liveStreamingDetails: { actualStartTime: "2026-07-14T00:00:00Z" } }),
        detail("privateVid1", { status: { privacyStatus: "private", license: "youtube", embeddable: true } }),
        detail("noEmbedVid1", { status: { privacyStatus: "public", license: "youtube", embeddable: false } }),
        detail("missingView1", { statistics: {} }),
        detail("validVideo1", { snippet: { ...detail("validVideo1").snippet, categoryId: "28" } }),
      ] }));

    const result = await collectSearchVideoPages({ fetchImpl: fetchMock });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      videoId: "noEmbedVid1",
      searchRank: 3,
    });
    expect(result.items[1]).toMatchObject({
      videoId: "validVideo1",
      category: "science",
      searchRank: 5,
      isKorean: true,
    });
  });

  it("does not log the API key when search fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 403));

    await expect(collectSearchVideoPages({ fetchImpl: fetchMock })).rejects.toBeInstanceOf(YoutubeFreeApiError);

    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("test-youtube-key");
    expect(errorSpy).toHaveBeenCalledWith("YouTube free search request failed", { status: 403 });
  });
});
