import "server-only";
import examples from "@/data/ranking-examples.json";
import { requireRankingAdmin, rankingReply, rankingError } from "@/lib/ranking-access";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireRankingAdmin(request);
    return rankingReply(examples);
  } catch (error) {
    return rankingError(error);
  }
}
