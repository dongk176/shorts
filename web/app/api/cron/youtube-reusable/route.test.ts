import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collectReusablePopularSearchVideos: vi.fn(),
}));

vi.mock("@/lib/youtube-popular-search", () => ({
  collectReusablePopularSearchVideos: mocks.collectReusablePopularSearchVideos,
  PopularSearchCollectionInProgressError: class PopularSearchCollectionInProgressError extends Error {},
}));
vi.mock("@/lib/youtube-free", () => ({
  YoutubeFreeApiError: class YoutubeFreeApiError extends Error {},
}));

import { GET } from "./route";

function request(secret?: string) {
  return new Request("http://localhost/api/cron/youtube-reusable", {
    headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-test-secret";
  mocks.collectReusablePopularSearchVideos.mockResolvedValue({
    runId: "6d1eeef5-6dc0-4f30-8af6-a95f08e9719c",
    snapshotDate: "2026-07-25",
    pages: 10,
    items: 350,
    totalItems: 2200,
    hasMoreOnYoutube: true,
  });
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.restoreAllMocks();
});

describe("reusable video collection cron", () => {
  it("rejects requests without the configured bearer secret", async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.collectReusablePopularSearchVideos).not.toHaveBeenCalled();
  });

  it("collects and appends reusable videos to a durable snapshot", async () => {
    const response = await GET(request("cron-test-secret"));

    expect(response.status).toBe(200);
    expect(mocks.collectReusablePopularSearchVideos).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      pages: 10,
      items: 350,
      totalItems: 2200,
    });
  });
});
