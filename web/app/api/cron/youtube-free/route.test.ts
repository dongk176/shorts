import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ collectFreeVideos: vi.fn() }));

vi.mock("@/lib/youtube-free", () => ({
  collectFreeVideos: mocks.collectFreeVideos,
  FreeCollectionInProgressError: class FreeCollectionInProgressError extends Error {},
  YoutubeFreeApiError: class YoutubeFreeApiError extends Error {},
}));

import { GET } from "./route";

function request(secret?: string) {
  return new Request("http://localhost/api/cron/youtube-free", {
    headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-test-secret";
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.FREE_SEARCH_MAX_PAGES;
  vi.restoreAllMocks();
});

describe("free video collection route", () => {
  it("rejects unauthenticated collection requests", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.collectFreeVideos).not.toHaveBeenCalled();
  });

  it("collects up to 30 search pages for the daily snapshot by default", async () => {
    mocks.collectFreeVideos.mockResolvedValue({
      runId: "run-a",
      snapshotDate: "2026-07-15",
      pages: 30,
      items: 1500,
      hasMoreOnYoutube: true,
    });

    const response = await GET(request("cron-test-secret"));

    expect(response.status).toBe(200);
    expect(mocks.collectFreeVideos).toHaveBeenCalledWith({ maxPages: 30 });
    await expect(response.json()).resolves.toMatchObject({ ok: true, pages: 30, items: 1500 });
  });

  it("can expand collection pages without changing code", async () => {
    process.env.FREE_SEARCH_MAX_PAGES = "12";
    mocks.collectFreeVideos.mockResolvedValue({
      runId: "run-b",
      snapshotDate: "2026-07-15",
      pages: 12,
      items: 580,
      hasMoreOnYoutube: true,
    });

    await GET(request("cron-test-secret"));

    expect(mocks.collectFreeVideos).toHaveBeenCalledWith({ maxPages: 12 });
  });

  it("caps collection at 30 search pages", async () => {
    process.env.FREE_SEARCH_MAX_PAGES = "100";
    mocks.collectFreeVideos.mockResolvedValue({
      runId: "run-c",
      snapshotDate: "2026-07-15",
      pages: 30,
      items: 1500,
      hasMoreOnYoutube: true,
    });

    await GET(request("cron-test-secret"));

    expect(mocks.collectFreeVideos).toHaveBeenCalledWith({ maxPages: 30 });
  });
});
