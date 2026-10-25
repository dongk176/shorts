import { timingSafeEqual } from "node:crypto";
import { processRankingEmails } from "@/lib/ranking-completion-email";
import { reconcileRankingVercel } from "@/lib/ranking-vercel";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET || ""}`),
    provided = Buffer.from(request.headers.get("authorization") || "");
  if (
    !process.env.CRON_SECRET ||
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.RANKING_SHORTS_ENABLED !== "1")
    return Response.json({ skipped: true });
  try {
    if (process.env.RANKING_VERCEL_SNAPSHOT_ID) await reconcileRankingVercel();
    return Response.json(await processRankingEmails());
  } catch {
    return Response.json(
      { error: "RankingEmailProcessingFailed" },
      { status: 500 },
    );
  }
}
