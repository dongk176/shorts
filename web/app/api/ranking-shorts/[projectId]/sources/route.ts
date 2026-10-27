import { queueRankingSource } from "@/lib/ranking-jobs";
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
    return rankingReply(
      await queueRankingSource(projectId, admin.id, await rankingBody(request), new URL(request.url).origin),
      202,
    );
  } catch (error) {
    return rankingError(error);
  }
}
