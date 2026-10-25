import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import {
  requireRankingAdmin,
  requireRankingProject,
  rankingReply,
  rankingError,
  rankingUuid,
} from "@/lib/ranking-access";
import {rankingUsesVercel,syncRankingVercelProjects,stopRankingVercel} from "@/lib/ranking-vercel";
export const dynamic = "force-dynamic";
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const admin = await requireRankingAdmin(request);
    const { projectId } = await params;
    await requireRankingProject(projectId, admin.id);
    await getDb().begin(async (tx) => {
      await tx`select id from shorts_mvp.ranking_projects where id=${projectId} for update`;
      const active =
        await tx`select id from shorts_mvp.ranking_operations where project_id=${projectId} and status in ('queued','running')`;
      if (active[0])
        throw new HttpError(409, "진행 중인 작업이 끝난 뒤 정리해 주세요.");
      await tx`update shorts_mvp.ranking_projects set deleted_at=now() where id=${projectId} and user_id=${admin.id}`;
    });
    if(rankingUsesVercel())await stopRankingVercel(projectId).catch(()=>undefined);
    return rankingReply({ ok: true });
  } catch (error) {
    return rankingError(error);
  }
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const admin = await requireRankingAdmin(request);
    const { projectId } = await params;
    const project = await requireRankingProject(projectId, admin.id);
    if(rankingUsesVercel())await syncRankingVercelProjects(admin.id);
    const requestedOperation = new URL(request.url).searchParams.get(
      "operation",
    );
    if (requestedOperation) rankingUuid(requestedOperation);
    const rows =
      await getDb()`select id,status,result,error,payload from shorts_mvp.ranking_operations
      where project_id=${projectId} and action='render'
      and (${requestedOperation}::uuid is null or id=${requestedOperation}::uuid)
      order by created_at desc limit 1`;
    const op = rows[0];
    if (requestedOperation && !op)
      throw new HttpError(404, "완성 영상을 찾을 수 없습니다.");
    return rankingReply({
      id: projectId,
      draft: op?.payload || project.draft,
      status: op?.status || "draft",
      error: op?.error,
      result:
        op?.status === "succeeded"
          ? {
              duration: op.result.duration,
              url: `/api/ranking-shorts/${projectId}/media/${op.id}?result=1`,
            }
          : null,
    });
  } catch (error) {
    return rankingError(error);
  }
}
