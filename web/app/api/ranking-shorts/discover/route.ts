import { requireRankingAdmin, rankingBody, rankingReply, rankingError } from "@/lib/ranking-access";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { rankingSearchSchema, rankingSearchOffset } from "@/lib/ranking-search-input";
import { searchRankingShortVideos } from "@/lib/ranking-semantic-search";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(request: Request) {
  try {
    await requireRankingAdmin(request);
    const parsed = rankingSearchSchema.safeParse(await rankingBody(request));
    if (!parsed.success) throw new HttpError(400,"검색어나 필터를 확인해 주세요.");
    try { rankingSearchOffset(parsed.data); } catch { throw new HttpError(400,"목록을 다시 검색해 주세요."); }
    return rankingReply(await searchRankingShortVideos(getDb(),parsed.data));
  } catch (error) { return rankingError(error); }
}
