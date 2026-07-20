import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPopularVideos: vi.fn(),
  getPopularSearchVideos: vi.fn(),
}));

vi.mock("@/lib/youtube-popular", () => ({
  getPopularVideos: mocks.getPopularVideos,
  popularVideoTypes: ["trending", "views"],
  popularVideoCategories: ["all", "entertainment", "gaming", "sports", "music", "news", "science", "howto"],
  PopularSnapshotUnavailableError: class PopularSnapshotUnavailableError extends Error {},
}));

vi.mock("@/lib/youtube-popular-search", () => ({
  getPopularSearchVideos: mocks.getPopularSearchVideos,
  PopularSearchSnapshotUnavailableError: class PopularSearchSnapshotUnavailableError extends Error {},
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("popular YouTube API route", () => {
  it("rejects unsupported filters before reading the database", async () => {
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=unknown"));
    expect(response.status).toBe(400);
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
    expect(mocks.getPopularSearchVideos).not.toHaveBeenCalled();
  });

  it("rejects an unsupported category before reading the database", async () => {
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=trending&category=unknown"));
    expect(response.status).toBe(400);
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
    expect(mocks.getPopularSearchVideos).not.toHaveBeenCalled();
  });

  it("rejects malformed long-form filter values", async () => {
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=trending&longForm=yes"));
    expect(response.status).toBe(400);
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
    expect(mocks.getPopularSearchVideos).not.toHaveBeenCalled();
  });

  it("rejects malformed Korean-language filter values", async () => {
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=trending&korean=yes"));
    expect(response.status).toBe(400);
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
    expect(mocks.getPopularSearchVideos).not.toHaveBeenCalled();
  });

  it("reads a filtered page from the stored snapshot", async () => {
    mocks.getPopularSearchVideos.mockResolvedValue({ items: [], updatedAt: "2026-07-14T00:00:00.000Z" });
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=views&category=gaming&reusable=true&longForm=true&korean=true"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getPopularSearchVideos).toHaveBeenCalledWith("gaming", true, true, true, undefined, 48);
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ items: [], updatedAt: "2026-07-14T00:00:00.000Z" });
  });

  it("passes only the opaque database cursor when loading more", async () => {
    mocks.getPopularVideos.mockResolvedValue({ items: [], updatedAt: "2026-07-14T00:00:00.000Z" });
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=trending&category=all&cursor=stored-page-2"));

    expect(response.status).toBe(200);
    expect(mocks.getPopularVideos).toHaveBeenCalledWith("trending", "all", false, false, false, "stored-page-2", 48);
    expect(mocks.getPopularSearchVideos).not.toHaveBeenCalled();
  });

  it("falls back to the existing stored chart until the first PRO search snapshot is ready", async () => {
    const unavailable = new (await import("@/lib/youtube-popular-search")).PopularSearchSnapshotUnavailableError();
    mocks.getPopularSearchVideos.mockRejectedValue(unavailable);
    mocks.getPopularVideos.mockResolvedValue({ items: [], updatedAt: "2026-07-14T00:00:00.000Z" });

    const response = await GET(new Request("http://localhost/api/youtube/popular?type=views&category=all"));

    expect(response.status).toBe(200);
    expect(mocks.getPopularVideos).toHaveBeenCalledWith("views", "all", false, false, false, undefined, 48);
  });

  it("returns a safe service error", async () => {
    mocks.getPopularSearchVideos.mockRejectedValue(new Error("secret database detail"));
    const response = await GET(new Request("http://localhost/api/youtube/popular?type=views&reusable=false"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ detail: "인기 영상을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." });
  });

  it("returns the same first page size for every plan", async () => {
    mocks.getPopularVideos.mockResolvedValue({
      items: [],
      updatedAt: "2026-07-14T00:00:00.000Z",
      nextCursor: "preview-page-2",
    });

    const response = await GET(new Request("http://localhost/api/youtube/popular?type=trending"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getPopularVideos).toHaveBeenCalledWith("trending", "all", false, false, false, undefined, 48);
    expect(mocks.getPopularSearchVideos).not.toHaveBeenCalled();
  });

  it("allows pagination without a plan entitlement", async () => {
    mocks.getPopularSearchVideos.mockResolvedValue({
      items: [],
      updatedAt: "2026-07-14T00:00:00.000Z",
    });

    const response = await GET(new Request("http://localhost/api/youtube/popular?type=views&cursor=preview-page-2"));

    expect(response.status).toBe(200);
    expect(mocks.getPopularVideos).not.toHaveBeenCalled();
    expect(mocks.getPopularSearchVideos).toHaveBeenCalledWith(
      "all", false, false, false, "preview-page-2", 48,
    );
  });

  it("allows advanced filters without a plan entitlement", async () => {
    mocks.getPopularVideos.mockResolvedValue({
      items: [],
      updatedAt: "2026-07-14T00:00:00.000Z",
    });

    const response = await GET(new Request("http://localhost/api/youtube/popular?type=trending&category=gaming&reusable=true&longForm=true"));

    expect(response.status).toBe(200);
    expect(mocks.getPopularVideos).toHaveBeenCalledWith("trending", "gaming", true, true, false, undefined, 48);
  });
});
