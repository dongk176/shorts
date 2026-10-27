import { requireRankingUser, rankingReply, rankingError } from "@/lib/ranking-access";
import { getDb } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await requireRankingUser();
    const rows = await getDb()`select exists(select 1 from shorts_mvp.video_jobs where user_id=${user.id} and status='completed') as eligible`;
    return rankingReply({eligible: rows[0]?.eligible === true});
  } catch(error) { return rankingError(error); }
}
