import { createRankingProject } from "@/lib/ranking-jobs";
import {
  requireRankingAdmin,
  rankingReply,
  rankingError,
} from "@/lib/ranking-access";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const admin = await requireRankingAdmin(request);
    return rankingReply(await createRankingProject(admin.id), 201);
  } catch (error) {
    return rankingError(error);
  }
}
export async function GET(request: Request) {
  try {
    const admin = await requireRankingAdmin(request);
    const { getDb } = await import("@/lib/db");
    const rows =
      await getDb()`select p.id,p.draft->>'title' as title,p.created_at,coalesce(o.status,'draft') as status from shorts_mvp.ranking_projects p left join lateral(select status from shorts_mvp.ranking_operations where project_id=p.id and action='render' order by created_at desc limit 1)o on true where p.user_id=${admin.id} and p.deleted_at is null and p.expires_at>now() order by p.created_at desc limit 20`;
    return rankingReply({ projects: rows });
  } catch (error) {
    return rankingError(error);
  }
}
