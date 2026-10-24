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
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const admin = await requireRankingAdmin(request);
    const { projectId } = await params;
    return rankingReply(
      await queueRankingOperation(
        projectId,
        admin.id,
        "render",
        await rankingBody(request),
      ),
      202,
    );
  } catch (error) {
    return rankingError(error);
  }
}
