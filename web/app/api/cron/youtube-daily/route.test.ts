import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collectPopularVideos: vi.fn(),
  collectPopularSearchVideos: vi.fn(),
  collectFreeVideos: vi.fn(),
}));

vi.mock("@/lib/youtube-popular", () => ({ collectPopularVideos: mocks.collectPopularVideos }));
vi.mock("@/lib/youtube-popular-search", () => ({
  collectPopularSearchVideos: mocks.collectPopularSearchVideos,
  POPULAR_SEARCH_PAGE_LIMIT: 40,
}));
vi.mock("@/lib/youtube-free", () => ({ collectFreeVideos: mocks.collectFreeVideos }));

import { GET } from "./route";

function request(secret?: string) {
  return new Request("http://localhost/api/cron/youtube-daily", {
    headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-test-secret";
  mocks.collectPopularVideos.mockResolvedValue({ items: 100 });
  mocks.collectPopularSearchVideos.mockResolvedValue({
    pages: 50,
    reusablePages: 10,
    items: 2200,
  });
  mocks.collectFreeVideos.mockResolvedValue({ pages: 30, items: 1300 });
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.restoreAllMocks();
});

describe("daily YouTube collection cron", () => {
  it("rejects requests without the configured bearer secret", async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.collectPopularVideos).not.toHaveBeenCalled();
  });

  it("collects trending, PRO plus reusable search, and FREE pages sequentially", async () => {
    const order: string[] = [];
    mocks.collectPopularVideos.mockImplementation(async () => { order.push("trending"); });
    mocks.collectPopularSearchVideos.mockImplementation(async () => { order.push("popularSearch"); });
    mocks.collectFreeVideos.mockImplementation(async () => { order.push("free"); });

    const response = await GET(request("cron-test-secret"));

    expect(response.status).toBe(200);
    expect(order).toEqual(["trending", "popularSearch", "free"]);
    expect(mocks.collectPopularSearchVideos).toHaveBeenCalledWith({ maxPages: 40 });
    expect(mocks.collectFreeVideos).toHaveBeenCalledWith({ maxPages: 30 });
  });

  it("continues remaining collections while reporting a failed step safely", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.collectPopularSearchVideos.mockRejectedValue(new Error("YOUTUBE_API_KEY=secret"));

    const response = await GET(request("cron-test-secret"));

    expect(response.status).toBe(503);
    expect(mocks.collectFreeVideos).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      failed: ["popularSearch"],
    });
  });
});
