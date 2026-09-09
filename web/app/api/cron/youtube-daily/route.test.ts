import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collectPopularVideos: vi.fn(),
  collectPopularSearchVideos: vi.fn(),
  collectFreeVideos: vi.fn(),
  collectDiscoveryLane: vi.fn(),
  expanded: vi.fn(),
}));

vi.mock("@/lib/youtube-popular", () => ({ collectPopularVideos: mocks.collectPopularVideos }));
vi.mock("@/lib/youtube-popular-search", () => ({
  collectPopularSearchVideos: mocks.collectPopularSearchVideos,
  POPULAR_SEARCH_PAGE_LIMIT: 40,
}));
vi.mock("@/lib/youtube-free", () => ({ collectFreeVideos: mocks.collectFreeVideos }));

vi.mock("@/lib/youtube-discovery-collector", () => ({ collectDiscoveryLane: mocks.collectDiscoveryLane }));
vi.mock("@/lib/youtube-quota", () => ({ discoveryEnabled: () => process.env.YOUTUBE_DISCOVERY_ENABLED === "true", expandedDiscoveryEnabled: mocks.expanded }));
import { GET } from "./route";

function request(secret?: string) {
  return new Request("http://localhost/api/cron/youtube-daily", {
    headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.expanded.mockResolvedValue(false);
  mocks.collectDiscoveryLane.mockResolvedValue({ failed: 0 });
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
  vi.unstubAllEnvs();
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

it("keeps one daily collection until expansion is verified", async () => {
  vi.stubEnv("YOUTUBE_DISCOVERY_ENABLED", "true");
  expect((await GET(request("cron-test-secret"))).status).toBe(200);
  expect(mocks.collectDiscoveryLane.mock.calls.map(([lane])=>lane)).toEqual(["trending","views","reusable","free"]);
  expect(mocks.collectDiscoveryLane.mock.calls.every(([,options])=>options.legacy)).toBe(true);
  expect(mocks.collectPopularVideos).not.toHaveBeenCalled();
});
it("does not overlap the old daily collector and expanded schedules", async () => {
  vi.stubEnv("YOUTUBE_DISCOVERY_ENABLED", "true"); mocks.expanded.mockResolvedValue(true);
  expect((await GET(request("cron-test-secret"))).status).toBe(200);
  expect(mocks.collectDiscoveryLane).not.toHaveBeenCalled();expect(mocks.collectPopularVideos).not.toHaveBeenCalled();
});
