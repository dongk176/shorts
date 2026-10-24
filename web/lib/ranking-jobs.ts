import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "./db";
import { HttpError } from "./http";
import {
  rankingRenderSchema,
  RANKING_LIMITS,
  type RankingSource,
} from "./ranking-shorts";
import { rankingUuid, requireRankingProject } from "./ranking-access";
import { rankingReceiverAccess, wakeRankingRuntime } from "./ranking-runtime";

const sourceInput = z
  .object({
    requestId: z.uuid(),
    url: z.string().url().max(2048).optional(),
    size: z
      .number()
      .int()
      .positive()
      .max(RANKING_LIMITS.sourceBytes)
      .optional(),
  })
  .strict()
  .refine((v) => Boolean(v.url) !== Boolean(v.size));
export async function createRankingProject(userId: string) {
  const db = getDb();
  return db.begin(async (tx) => {
    // Serializes only this administrator's admissions; never locks ordinary jobs.
    await tx`select id from shorts_mvp.app_users where id=${userId} and is_admin=true for update`;
    const count =
      await tx`select count(*)::integer as count from shorts_mvp.ranking_projects where user_id=${userId} and deleted_at is null and expires_at>now()`;
    if (count[0].count >= 20)
      throw new HttpError(
        409,
        "보관 중인 랭킹 작업이 많습니다. 이전 작업을 정리해 주세요.",
      );
    const id = randomUUID();
    await tx`insert into shorts_mvp.ranking_projects(id,user_id) values(${id},${userId})`;
    return { id };
  });
}
function operationResponse(projectId: string, operationId: string) {
  return {
    operationId,
    pollUrl: `/api/ranking-shorts/${projectId}/operations/${operationId}`,
  };
}
export async function queueRankingSource(
  projectId: string,
  owner: string,
  input: unknown,
) {
  const value = sourceInput.safeParse(input);
  if (!value.success)
    throw new HttpError(400, "영상 링크 또는 250MB 이하 파일을 확인해 주세요.");
  const { requestId, url, size } = value.data;
  if (url) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      ![
        "www.youtube.com",
        "youtube.com",
        "youtu.be",
        "m.youtube.com",
        "www.instagram.com",
        "instagram.com",
        "www.tiktok.com",
        "tiktok.com",
        "vm.tiktok.com",
        "vt.tiktok.com",
      ].includes(parsed.hostname)
    )
      throw new HttpError(
        400,
        "유튜브·인스타그램·틱톡 공개 영상 링크를 넣어 주세요.",
      );
  }
  await requireRankingProject(projectId, owner);
  const ready = await wakeRankingRuntime();
  if (size && !ready) return { preparing: true };
  const db = getDb();
  const op = await db.begin(async (tx) => {
    await tx`select id from shorts_mvp.ranking_projects where id=${projectId} for update`;
    const existing =
      await tx`select id,source_id from shorts_mvp.ranking_operations where project_id=${projectId} and request_id=${requestId}`;
    if (existing[0]) return existing[0];
    const active =
      await tx`select id from shorts_mvp.ranking_operations where project_id=${projectId} and status in ('queued','running')`;
    if (active[0])
      throw new HttpError(
        409,
        "진행 중인 작업이 있습니다. 완료 후 다시 시도해 주세요.",
      );
    const count =
      await tx`select count(*)::integer as count from shorts_mvp.ranking_sources where project_id=${projectId}`;
    if (count[0].count >= 30)
      throw new HttpError(
        409,
        "작업당 영상은 최대 30개입니다. 새로 시작해 주세요.",
      );
    const id = randomUUID(),
      sourceId = randomUUID();
    await tx`insert into shorts_mvp.ranking_sources(id,project_id,status,remote_url,size_bytes) values(${sourceId},${projectId},${size ? "uploading" : "queued"},${url || null},${size || null})`;
    await tx`insert into shorts_mvp.ranking_operations(id,project_id,source_id,action,request_id) values(${id},${projectId},${sourceId},${size ? "import" : "inspect"},${requestId})`;
    return { id, sourceId };
  });
  return {
    ...operationResponse(projectId, op.id),
    ...(size
      ? { upload: rankingReceiverAccess("PUT", projectId, op.sourceId, owner) }
      : {}),
  };
}
export async function queueRankingOperation(
  projectId: string,
  owner: string,
  action: "preview" | "render",
  input: unknown,
  sourceId?: string,
) {
  await requireRankingProject(projectId, owner);
  const envelope = z
    .object({ requestId: z.uuid(), spec: rankingRenderSchema.optional() })
    .strict()
    .safeParse(input);
  if (!envelope.success || (action === "render" && !envelope.data.spec))
    throw new HttpError(400, "선택한 구간과 제목을 확인해 주세요.");
  const spec = envelope.data.spec;
  if (sourceId) rankingUuid(sourceId);
  await wakeRankingRuntime();
  const operationId = await getDb().begin(async (tx) => {
    await tx`select id from shorts_mvp.ranking_projects where id=${projectId} for update`;
    const existing =
      await tx`select id from shorts_mvp.ranking_operations where project_id=${projectId} and request_id=${envelope.data.requestId}`;
    if (existing[0]) return existing[0].id;
    const active =
      await tx`select id from shorts_mvp.ranking_operations where project_id=${projectId} and status in ('queued','running')`;
    if (active[0]) throw new HttpError(409, "진행 중인 작업이 있습니다.");
    const sources =
      await tx`select id,status,metadata,remote_url from shorts_mvp.ranking_sources where project_id=${projectId}`;
    if (action === "preview") {
      if (!sources.some((s) => s.id === sourceId && s.remoteUrl))
        throw new HttpError(404, "원본 영상을 다시 추가해 주세요.");
    } else
      for (const clip of spec!.clips) {
        const source = sources.find((s) => s.id === clip.sourceId);
        if (
          !source ||
          source.status !== "ready" ||
          !source.metadata ||
          source.metadata.durationKnown === false ||
          clip.end > source.metadata.duration
        )
          throw new HttpError(
            400,
            `${clip.rank}위 영상의 구간을 다시 확인해 주세요.`,
          );
      }
    const id = randomUUID();
    await tx`insert into shorts_mvp.ranking_operations(id,project_id,source_id,action,payload,request_id) values(${id},${projectId},${sourceId || null},${action},${tx.json(spec || {})},${envelope.data.requestId})`;
    if (spec)
      await tx`update shorts_mvp.ranking_projects set draft=${tx.json(spec)} where id=${projectId}`;
    return id;
  });
  return operationResponse(projectId, operationId);
}
export async function rankingOperation(
  projectId: string,
  operationId: string,
  owner: string,
) {
  await requireRankingProject(projectId, owner);
  rankingUuid(operationId);
  const rows =
    await getDb()`select id,status,result,error,action from shorts_mvp.ranking_operations where project_id=${projectId} and id=${operationId}`;
  if (!rows[0]) throw new HttpError(404, "작업을 찾을 수 없습니다.");
  const row = rows[0];
  const result =
    row.status === "succeeded"
      ? row.action === "render"
        ? {
            duration: row.result.duration,
            url: `/api/ranking-shorts/${projectId}/media/${row.id}?result=1`,
          }
        : { source: row.result.source as RankingSource }
      : null;
  return { status: row.status, result, error: row.error };
}
