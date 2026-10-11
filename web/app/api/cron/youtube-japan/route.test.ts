import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ collect: vi.fn() }));
vi.mock("@/lib/youtube-japan-collector", () => ({ collectJapanVideos: mocks.collect,
  japanCollectionSlot: () => new Date("2026-10-11T08:15:00Z") }));
import { GET } from "./route";
const request = (query = "", secret = "test-secret") => new Request(`https://example.com/api/cron/youtube-japan${query}`, {
  headers: { authorization: `Bearer ${secret}` },
});
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-11T09:00:00Z")); vi.stubEnv("CRON_SECRET", "test-secret"); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("requires authentication even for recovery", async () => {
  expect((await GET(request("?catchUp=1", "wrong"))).status).toBe(401);
  expect(mocks.collect).not.toHaveBeenCalled();
});
it("keeps ordinary requests within the scheduled window", async () => {
  expect(await (await GET(request())).json()).toMatchObject({ reason: "outside_slot" });
  expect(mocks.collect).not.toHaveBeenCalled();
});
it("recovers only the latest elapsed slot and retains collector duplicate guards", async () => {
  mocks.collect.mockResolvedValue({ skipped: true, reason: "already_collected" });
  expect((await GET(request("?catchUp=1"))).status).toBe(200);
  expect(mocks.collect).toHaveBeenCalledWith({ scheduledAt: new Date("2026-10-11T08:15:00Z") });
});
it("reports unverified quota as a visible cron failure", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.collect.mockResolvedValue({ skipped: true, reason: "japan_quota_unverified" });
  expect((await GET(request("?catchUp=1"))).status).toBe(503);
});
