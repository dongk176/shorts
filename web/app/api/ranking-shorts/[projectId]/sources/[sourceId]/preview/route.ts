import { queueRankingOperation } from "@/lib/ranking-jobs";
import {
  requireRankingAdmin,
  rankingReply,
  rankingError,
  rankingBody,
} from "@/lib/ranking-access";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; sourceId: string }> },
) {
  try {
    const admin = await requireRankingAdmin(request);
    const { projectId, sourceId } = await params;
    return rankingReply(
      await queueRankingOperation(
        projectId,
        admin.id,
        "preview",
        await rankingBody(request),
        sourceId,
      ),
      202,
    );
  } catch (error) {
    return rankingError(error);
  }
}
