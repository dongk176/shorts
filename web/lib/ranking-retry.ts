import "server-only";
import { rankingSoundSchema } from "./ranking-audio";
import { z } from "zod";
import { getDb } from "./db";
import { requireRankingProject } from "./ranking-access";
import { queueRankingOperation } from "./ranking-jobs";
import { HttpError } from "./http";

export async function retryRankingRender(project: string, owner: string, input: unknown, origin: string) {
  await requireRankingProject(project, owner);
  const parsed = z.object({requestId:z.uuid(), retryOperationId:z.uuid(), transitionSound:rankingSoundSchema.nullable().optional()}).strict().safeParse(input);
  if (!parsed.success) throw new HttpError(400, "다시 만들 작업을 확인해 주세요.");
  const rows = await getDb()`select payload,status from shorts_mvp.ranking_operations where id=${parsed.data.retryOperationId} and project_id=${project} and action='render' and status in ('failed','succeeded')`;
  if (!rows[0] || (rows[0].status === "succeeded" && !("transitionSound" in parsed.data))) throw new HttpError(404, "실패한 제작 작업을 찾을 수 없습니다.");
  return queueRankingOperation(project, owner, "render", {requestId:parsed.data.requestId,spec:{...rows[0].payload,...("transitionSound" in parsed.data ? {transitionSound:parsed.data.transitionSound,transitionVersion:2} : {})}}, undefined, origin);
}
