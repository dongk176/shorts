import { queueRankingOperation } from "@/lib/ranking-jobs";
import {
  requireRankingUser,
  rankingReply,
  rankingError,
  rankingBody,
} from "@/lib/ranking-access";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; sourceId: string }> },
) {
  try {
    const admin = await requireRankingUser(request);
    const { projectId, sourceId } = await params;
    return rankingReply(
      await queueRankingOperation(
        projectId,
        admin.id,
        "preview",
        await rankingBody(request),
        sourceId, new URL(request.url).origin,
      ),
      202,
    );
  } catch (error) {
    return rankingError(error);
  }
}
