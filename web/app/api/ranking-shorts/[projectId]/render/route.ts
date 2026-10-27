import { retryRankingRender } from "@/lib/ranking-retry";
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
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const admin = await requireRankingUser(request);
    const { projectId } = await params;
    const input = await rankingBody(request);
    if (input && typeof input === "object" && "retryOperationId" in input)
      return rankingReply(await retryRankingRender(projectId, admin.id, input, new URL(request.url).origin), 202);
    return rankingReply(
      await queueRankingOperation(
        projectId,
        admin.id,
        "render",
        input,
        undefined, new URL(request.url).origin,
      ),
      202,
    );
  } catch (error) {
    return rankingError(error);
  }
}
