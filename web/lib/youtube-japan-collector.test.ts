import { describe, it, expect, vi } from "vitest";
import { japanSearchSources, japanCollectionSlot, collectJapanVideos } from "./youtube-japan-collector";
vi.mock("server-only", () => ({}));
describe("Japanese discovery plan", () => {
  it("covers every category three times per week with exactly three recent queries per day", () => {
    const counts = new Map<string, number>();
    for (let day = 0; day < 7; day++) {
      const date = new Date(Date.UTC(2026, 8, 11 + day, 8, 15));
      const sources = japanSearchSources("views", date);
      expect(sources).toHaveLength(3);
      for (const source of sources) {
        expect(source).toMatchObject({ regionCode: "JP", relevanceLanguage: "ja", publishedAfter: new Date(date.getTime() - 7 * 86400000) });
        counts.set(source.videoCategoryId!, (counts.get(source.videoCategoryId!) || 0) + 1);
      }
    }
    expect(counts.size).toBe(7); expect([...counts.values()]).toEqual(Array(7).fill(3));
  });
  it("uses seven unbounded CC categories and a single 17:15 Japan/Korea slot", () => {
    expect(japanSearchSources("reusable", new Date())).toHaveLength(7);
    expect(japanSearchSources("reusable", new Date()).every(source => source.publishedAfter === null)).toBe(true);
    expect(japanCollectionSlot(new Date("2026-09-11T08:14:00Z")).toISOString()).toBe("2026-09-10T08:15:00.000Z");
    expect(japanCollectionSlot(new Date("2026-09-11T08:16:00Z")).toISOString()).toBe("2026-09-11T08:15:00.000Z");
  });
  it("does nothing while collection is disabled, even without database credentials", async () => {
    vi.stubEnv("YOUTUBE_JP_COLLECTION_ENABLED", "false");
    expect(await collectJapanVideos()).toEqual({ skipped: true, reason: "disabled" });
    vi.unstubAllEnvs();
  });
});
