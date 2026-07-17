import { describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { getGeneratedShortCount, getShortsForJobs } from "./data";

describe("generated shorts counter", () => {
  it("returns the persisted public counter as a number", async () => {
    const db = vi.fn().mockResolvedValue([{ value: "4327" }]) as unknown as Sql;

    await expect(getGeneratedShortCount(db)).resolves.toBe(4327);
  });
});

describe("generated short details", () => {
  it("maps the persisted Gemini highlight reason", async () => {
    const query = vi.fn()
      .mockReturnValueOnce(["job-a"])
      .mockResolvedValueOnce([{
        id: "short-a",
        jobId: "job-a",
        clipIndex: 1,
        startSeconds: "12",
        endSeconds: "54",
        durationSeconds: "42",
        hookTitle: "후킹 제목",
        highlightReason: "반전이 드러나는 핵심 발언이 포함된 구간입니다.",
        channelDisplayName: "채널",
        subtitleSegments: [],
        subtitlesEnabled: false,
        templateId: "dark-red",
        videoAspectRatio: "9:16",
        titleFontScale: "1",
        renderVersion: 1,
        rerenderProgress: 100,
        status: "ready",
        expiresAt: new Date("2026-08-01T00:00:00.000Z"),
      }]) as unknown as Sql;

    const shorts = await getShortsForJobs(query, ["job-a"]);

    expect(shorts.get("job-a")?.[0]?.highlightReason).toBe(
      "반전이 드러나는 핵심 발언이 포함된 구간입니다.",
    );
  });
});
