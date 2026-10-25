import { loadRankingProjectList } from "@/lib/ranking-project-list";
import { createRankingProject } from "@/lib/ranking-jobs";
import {
  requireRankingAdmin,
  rankingReply,
  rankingError,
} from "@/lib/ranking-access";
import {rankingUsesVercel,syncRankingVercelProjects} from "@/lib/ranking-vercel";
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
    if(rankingUsesVercel())await syncRankingVercelProjects(admin.id);
    return rankingReply({ projects: await loadRankingProjectList(admin.authUserId) });
  } catch (error) {
    return rankingError(error);
  }
}
