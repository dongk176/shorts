import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getFreeVideos: vi.fn() }));

vi.mock("@/lib/youtube-free", () => ({
  getFreeVideos: mocks.getFreeVideos,
  FreeSnapshotUnavailableError: class FreeSnapshotUnavailableError extends Error {},
}));

import { GET } from "./route";

beforeEach(() => vi.clearAllMocks());

describe("free YouTube API route", () => {
  it("reads the latest free snapshot", async () => {
    mocks.getFreeVideos.mockResolvedValue({ items: [], updatedAt: "2026-07-15T00:00:00.000Z" });

    const response = await GET(new Request("http://localhost/api/youtube/free"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    expect(mocks.getFreeVideos).toHaveBeenCalledWith(false, undefined);
  });

  it("passes the database cursor for later pages", async () => {
    mocks.getFreeVideos.mockResolvedValue({ items: [], updatedAt: "2026-07-15T00:00:00.000Z" });

    await GET(new Request("http://localhost/api/youtube/free?cursor=stored-page-2&korean=true"));

    expect(mocks.getFreeVideos).toHaveBeenCalledWith(true, "stored-page-2");
  });

  it("rejects malformed Korean-language filter values", async () => {
    const response = await GET(new Request("http://localhost/api/youtube/free?korean=yes"));

    expect(response.status).toBe(400);
    expect(mocks.getFreeVideos).not.toHaveBeenCalled();
  });

  it("returns a safe service error", async () => {
    mocks.getFreeVideos.mockRejectedValue(new Error("secret database detail"));

    const response = await GET(new Request("http://localhost/api/youtube/free"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      detail: "오늘의 무료 소재를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    });
  });
});
