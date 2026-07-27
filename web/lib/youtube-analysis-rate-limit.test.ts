import type { Sql } from "postgres";
import { describe, expect, it, vi } from "vitest";
import { assertYoutubeAnalysisRequestAllowed } from "./youtube-analysis-rate-limit";

function dbWithRows(rows: unknown[]) {
  return vi.fn().mockResolvedValue(rows) as unknown as Sql;
}

describe("YouTube analysis rate limit", () => {
  it("allows a request claimed by the database limiter", async () => {
    const db = dbWithRows([{ allowed: true, retryAfterSeconds: 0 }]);

    await expect(assertYoutubeAnalysisRequestAllowed("user-a", db)).resolves.toBeUndefined();
  });

  it("returns a temporary lock with the database retry interval", async () => {
    const db = dbWithRows([{ allowed: false, retryAfterSeconds: 301 }]);

    await expect(assertYoutubeAnalysisRequestAllowed("user-a", db)).rejects.toMatchObject({
      status: 429,
      code: "YOUTUBE_ANALYSIS_RATE_LIMITED",
      retryAfterSeconds: 301,
      message: "영상 분석 요청이 너무 많아 잠시 잠겼습니다. 6분 후 다시 시도해 주세요.",
    });
  });
});
