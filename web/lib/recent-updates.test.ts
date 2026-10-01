import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ sql: vi.fn(), cache: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.sql }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown, keys: unknown, options: unknown) => {
  mocks.cache(keys, options);
  return fn;
} }));
import { recentUpdateDates, RECENT_UPDATES_TAG } from "./recent-updates";
import { GET } from "@/app/api/updates/recent/route";

describe("public recent update dates", () => {
  beforeEach(() => { mocks.sql.mockReset(); });
  it("uses a one-minute tagged server cache without caching private responses", async () => {
    expect(mocks.cache).toHaveBeenCalledWith(["public-recent-updates-v1"], { revalidate: 60, tags: [RECENT_UPDATES_TAG] });
    mocks.sql.mockResolvedValue([{ date: "2026-10-01" }]);
    const response = await GET();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ publishedAt: [Date.parse("2026-10-01T00:00:00+09:00")] });
  });
  it("coalesces concurrent cache misses and retries failed reads", async () => {
    let resolve!: (value: { date: string }[]) => void;
    mocks.sql.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
    const first = recentUpdateDates();
    const second = recentUpdateDates();
    expect(mocks.sql).toHaveBeenCalledOnce();
    resolve([]);
    expect(await Promise.all([first, second])).toEqual([[], []]);
    mocks.sql.mockRejectedValueOnce(new Error("offline"));
    await expect(recentUpdateDates()).rejects.toThrow("offline");
    mocks.sql.mockResolvedValue([]);
    await expect(recentUpdateDates()).resolves.toEqual([]);
  });
});
