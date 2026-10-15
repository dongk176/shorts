import { describe, it, expect, vi, afterEach } from "vitest";
import { collectEnglishVideos, englishCollectionSlot } from "./youtube-english-collector";
vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllEnvs());
describe("English trending schedule", () => {
  it("uses the last elapsed four-hour slot, including midnight rollover", () => {
    expect(englishCollectionSlot(new Date("2026-10-15T00:24:59Z")).toISOString()).toBe("2026-10-14T20:25:00.000Z");
    expect(englishCollectionSlot(new Date("2026-10-15T00:25:00Z")).toISOString()).toBe("2026-10-15T00:25:00.000Z");
    expect(englishCollectionSlot(new Date("2026-10-15T07:59:00Z")).toISOString()).toBe("2026-10-15T04:25:00.000Z");
  });
  it("does no DB/API work when disabled", async () => {
    vi.stubEnv("YOUTUBE_EN_COLLECTION_ENABLED", "false");
    expect(await collectEnglishVideos()).toEqual({ skipped: true, reason: "disabled" });
  });
});
