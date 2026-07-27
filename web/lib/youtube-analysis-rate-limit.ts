import type { Sql } from "postgres";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";

type YoutubeAnalysisRateLimitRow = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export async function assertYoutubeAnalysisRequestAllowed(
  userId: string,
  db: Sql = getDb(),
) {
  const rows = await db<YoutubeAnalysisRateLimitRow[]>`
    select allowed, retry_after_seconds
    from shorts_mvp.consume_youtube_analysis_request(${userId})
  `;
  const result = rows[0];
  if (!result?.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil(Number(result?.retryAfterSeconds) || 600));
    const retryAfterMinutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    throw new HttpError(
      429,
      `영상 분석 요청이 너무 많아 잠시 잠겼습니다. ${retryAfterMinutes}분 후 다시 시도해 주세요.`,
      "YOUTUBE_ANALYSIS_RATE_LIMITED",
      retryAfterSeconds,
    );
  }
}
