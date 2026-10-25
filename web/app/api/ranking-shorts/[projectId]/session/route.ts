import {
  requireRankingAdmin,
  requireRankingProject,
  rankingReply,
  rankingError,
} from "@/lib/ranking-access";
import { rankingUsesVercel, stopRankingVercel } from "@/lib/ranking-vercel";
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const admin = await requireRankingAdmin(request);
    const { projectId } = await params;
    await requireRankingProject(projectId, admin.id);
    if (rankingUsesVercel()) await stopRankingVercel(projectId);
    return rankingReply({ ok: true });
  } catch (error) {
    return rankingError(error);
  }
}
