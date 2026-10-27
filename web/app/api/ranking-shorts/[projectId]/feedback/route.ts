import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { rankingBody, rankingError, rankingReply, rankingUuid, requireRankingProject, requireRankingUser } from "@/lib/ranking-access";
import { z } from "zod";

export const dynamic = "force-dynamic";
const submission = z.object({
  operationId: z.string().uuid(),
  rating: z.enum(["good", "okay", "poor"]).nullable(),
  comment: z.string().trim().max(1000).default(""),
}).strict();
type Context = { params: Promise<{ projectId: string }> };

async function ownedResult(request: Request, context: Context, operationId: string) {
  const user = await requireRankingUser(request);
  const { projectId } = await context.params;
  await requireRankingProject(projectId, user.id);
  rankingUuid(operationId);
  const rows = await getDb()`select id from shorts_mvp.ranking_operations
    where id=${operationId} and project_id=${projectId} and action='render' and status='succeeded'`;
  if (!rows[0]) throw new HttpError(404, "완성 영상을 찾을 수 없습니다.");
  return user;
}

export async function GET(request: Request, context: Context) {
  try {
    const operationId = new URL(request.url).searchParams.get("operation") || "";
    const user = await ownedResult(request, context, operationId);
    const rows = await getDb()`select operation_id from shorts_mvp.ranking_feedback
      where operation_id=${operationId} and user_id=${user.id}`;
    return rankingReply({ handled: Boolean(rows[0]) });
  } catch (error) { return rankingError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const parsed = submission.safeParse(await rankingBody(request));
    if (!parsed.success) throw new HttpError(400, "평가와 의견을 확인해 주세요. 의견은 1,000자까지 입력할 수 있어요.");
    const { operationId, rating, comment } = parsed.data;
    const user = await ownedResult(request, context, operationId);
    await getDb()`insert into shorts_mvp.ranking_feedback (operation_id,user_id,rating,comment)
      values (${operationId},${user.id},${rating},${rating ? comment : ""})
      on conflict (operation_id) do nothing`;
    return rankingReply({ handled: true });
  } catch (error) { return rankingError(error); }
}
