import "server-only";
import { z } from "zod";
import { getDb } from "./db";
import { requireRankingProject } from "./ranking-access";
import { queueRankingOperation } from "./ranking-jobs";
import { HttpError } from "./http";

export async function retryRankingRender(project: string, owner: string, input: unknown, origin: string) {
  await requireRankingProject(project, owner);
  const parsed = z.object({requestId:z.uuid(), retryOperationId:z.uuid()}).strict().safeParse(input);
  if (!parsed.success) throw new HttpError(400, "다시 만들 작업을 확인해 주세요.");
  const rows = await getDb()`select payload from shorts_mvp.ranking_operations where id=${parsed.data.retryOperationId} and project_id=${project} and action='render' and status='failed'`;
  if (!rows[0]) throw new HttpError(404, "실패한 제작 작업을 찾을 수 없습니다.");
  return queueRankingOperation(project, owner, "render", {requestId:parsed.data.requestId,spec:rows[0].payload}, undefined, origin);
}
