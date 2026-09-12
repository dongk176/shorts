import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), db: {} }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/reusable-view-counter-server", () => ({ getPublicSiteMetrics: mocks.read }));
const schedule = { startValue: 1000, targetValue: 2000, startedAt: "2026-09-12T08:15:00Z", endsAt: "2026-09-12T20:10:00Z" };

describe("public home metrics", () => {
  beforeEach(() => {
    vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-12T09:00:00Z"));
    mocks.read.mockReset().mockResolvedValue({ generatedShortCount: 3000, reusableViewCounter: schedule });
  });
  afterEach(() => vi.useRealTimers());
  it("returns only the existing public totals, with a fresh clock even when data is cached", async () => {
    const { GET } = await import("./route");
    const first = await GET();
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(await first.json()).toEqual({ generatedShortCount: 3000, reusableViewCounter: { ...schedule, serverNow: "2026-09-12T09:00:00.000Z" } });
    vi.advanceTimersByTime(15_000);
    expect((await (await GET()).json()).reusableViewCounter.serverNow).toBe("2026-09-12T09:00:15.000Z");
    expect(mocks.read).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    mocks.read.mockResolvedValue({ generatedShortCount: 3001, reusableViewCounter: { ...schedule, targetValue: 2500 } });
    expect((await (await GET()).json()).reusableViewCounter.targetValue).toBe(2500);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });
  it("shares concurrent public reads without creating jobs or invoking YouTube", async () => {
    const { GET } = await import("./route");
    await Promise.all([GET(), GET(), GET()]);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.read).toHaveBeenCalledWith(mocks.db);
  });
  it("does not turn a DB failure into a zero total and recovers on the next request", async () => {
    const { GET } = await import("./route");
    mocks.read.mockRejectedValueOnce(new Error("DB unavailable"));
    expect((await GET()).status).toBe(503);
    expect((await (await GET()).json()).reusableViewCounter.targetValue).toBe(2000);
  });
});
