import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  entries: new Map<string, { expires: number; value: unknown }>(),
  cacheDepth: 0,
  now: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.query }));
vi.mock("next/cache", () => ({
  unstable_cache: (callback: (...args: unknown[]) => Promise<unknown>, keys: string[], options: { revalidate: number }) =>
    async (...args: unknown[]) => {
      // Nested wrappers bypass reads in Next 15; disallow that regression here.
      expect(mocks.cacheDepth).toBe(0);
      const key = JSON.stringify([keys, args]);
      const cached = mocks.entries.get(key);
      if (cached && cached.expires > mocks.now) return cached.value;
      mocks.cacheDepth += 1;
      try {
        const value = await callback(...args);
        mocks.entries.set(key, { expires: mocks.now + options.revalidate * 1_000, value });
        return value;
      } finally { mocks.cacheDepth -= 1; }
    },
}));

import { loadAdminOverview, loadAdminTrend } from "./admin-overview";

beforeEach(() => {
  mocks.query.mockReset().mockResolvedValue([]);
  mocks.entries.clear();
  mocks.cacheDepth = 0;
  mocks.now = 0;
});

describe("administrator trend caches", () => {
  it("shares history across periods and refreshes recent data after 30 seconds", async () => {
    mocks.query
      .mockResolvedValueOnce([{ date: "2026-09-03", sales: "10000", orderCount: 1 }])
      .mockResolvedValueOnce([{ date: "2026-09-05", sales: "20000", orderCount: 2 }]);
    const first = await loadAdminTrend("sales", "7d", "2026-09-05");
    expect(first.points.reduce((sum, row) => sum + row.value, 0)).toBe(30_000);
    await loadAdminTrend("sales", "30d", "2026-09-05");
    await loadAdminTrend("sales", "6m", "2026-09-05");
    await loadAdminTrend("sales", "all", "2026-09-05");
    expect(mocks.query).toHaveBeenCalledTimes(2);

    mocks.now = 31_000;
    mocks.query.mockResolvedValueOnce([{ date: "2026-09-05", sales: "30000", orderCount: 3 }]);
    const updated = await loadAdminTrend("sales", "7d", "2026-09-05");
    expect(mocks.query).toHaveBeenCalledTimes(3);
    expect(updated.points.reduce((sum, row) => sum + row.value, 0)).toBe(40_000);

    mocks.now = 86_400_001;
    await loadAdminTrend("sales", "7d", "2026-09-05");
    expect(mocks.query).toHaveBeenCalledTimes(5);
  });

  it("uses disjoint KST boundaries and changes both cache keys at midnight", async () => {
    await loadAdminTrend("members", "7d", "2026-09-05");
    const [history, recent] = mocks.query.mock.calls;
    expect(history.slice(1)).toEqual([null, null, "2026-09-04T00:00:00+09:00"]);
    expect(recent.slice(1)).toEqual([
      "2026-09-04T00:00:00+09:00", "2026-09-04T00:00:00+09:00", "2026-09-06T00:00:00+09:00",
    ]);
    expect(history[0].join("?")).toContain("created_at <");
    expect(recent[0].join("?")).toContain("created_at >=");
    await loadAdminTrend("members", "7d", "2026-09-06");
    expect(mocks.query).toHaveBeenCalledTimes(4);
    expect(mocks.query.mock.calls[2].at(-1)).toBe("2026-09-05T00:00:00+09:00");
  });

  it("keeps sales and member aggregates separate and uses existing business filters", async () => {
    await loadAdminTrend("sales", "7d", "2026-09-05");
    const sql = mocks.query.mock.calls[0][0].join("?");
    expect(sql).toContain("status='succeeded' and amount_krw>0");
    expect(sql).toContain("approved_at at time zone 'Asia/Seoul'");
    mocks.query.mockResolvedValueOnce([{ date: "2026-09-02", memberCount: 7 }]);
    const members = await loadAdminTrend("members", "all", "2026-09-05");
    expect(mocks.query).toHaveBeenCalledTimes(4);
    expect(members.points[0]).toEqual({ date: "2026-09-02", value: 7 });
  });

  it("does not cache database failures as zero-valued history", async () => {
    mocks.query.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(loadAdminTrend("sales", "7d", "2026-09-05")).rejects.toThrow("database unavailable");
    expect(mocks.entries.size).toBe(0);
    await loadAdminTrend("sales", "7d", "2026-09-05");
    expect(mocks.query).toHaveBeenCalledTimes(3);
  });

  it("loads the initial overview without nesting caches or parallel database reads", async () => {
    const data = await loadAdminOverview();
    expect(data.salesTrend.period).toBe("7d");
    expect(data.memberTrend.points).toHaveLength(7);
    expect(mocks.query).toHaveBeenCalledTimes(5);
    await loadAdminOverview();
    expect(mocks.query).toHaveBeenCalledTimes(5);
  });
});
