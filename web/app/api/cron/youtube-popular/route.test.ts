import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ collectPopularVideos: vi.fn() }));

vi.mock("@/lib/youtube-popular", () => ({
  collectPopularVideos: mocks.collectPopularVideos,
  PopularCollectionInProgressError: class PopularCollectionInProgressError extends Error {},
  YoutubePopularApiError: class YoutubePopularApiError extends Error {},
}));

import { GET } from "./route";

function request(secret?: string) {
  return new Request("http://localhost/api/cron/youtube-popular", {
    headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-test-secret";
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.restoreAllMocks();
});

describe("popular video collection cron", () => {
  it("rejects requests without the configured bearer secret", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.collectPopularVideos).not.toHaveBeenCalled();
  });

  it("runs the complete collector for an authenticated request", async () => {
    mocks.collectPopularVideos.mockResolvedValue({
      runId: "run-a",
      snapshotDate: "2026-07-15",
      pages: 18,
      items: 700,
      categories: [],
    });

    const response = await GET(request("cron-test-secret"));

    expect(response.status).toBe(200);
    expect(mocks.collectPopularVideos).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({ ok: true, pages: 18, items: 700 });
  });

  it("does not expose internal collector errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.collectPopularVideos.mockRejectedValue(new Error("DATABASE_URL=secret"));

    const response = await GET(request("cron-test-secret"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ detail: "인기 영상 수집 중 내부 오류가 발생했습니다." });
  });
});
