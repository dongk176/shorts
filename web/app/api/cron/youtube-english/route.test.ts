import { afterEach, describe, expect, it, vi } from "vitest";
const collect = vi.hoisted(() => vi.fn());
vi.mock("@/lib/youtube-english-collector", () => ({
  collectEnglishVideos: collect,
  englishCollectionSlot: () => new Date("2026-10-15T04:25:00Z"),
}));
import { GET } from "./route";
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("English cron authentication and recovery", () => {
  it("rejects unauthenticated collection", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    expect((await GET(new Request("https://example.com/api/cron/youtube-english"))).status).toBe(401);
    expect(collect).not.toHaveBeenCalled();
  });
  it("allows delayed delivery and manual Run only through the bounded collector", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret"); vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T05:00:00Z"));
    const options = { headers: { authorization: "Bearer test-secret" } };
    collect.mockResolvedValue({ skipped:false,failed:false });
    expect((await GET(new Request("https://example.com/api/cron/youtube-english", options))).status).toBe(200);
    expect(collect).toHaveBeenCalledWith({scheduledAt:new Date("2026-10-15T04:25:00Z")});
  });
});
