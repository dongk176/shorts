import { rankingOperation } from "@/lib/ranking-jobs";
import {
  requireRankingAdmin,
  rankingReply,
  rankingError,
} from "@/lib/ranking-access";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string; operationId: string }> },
) {
  try {
    const admin = await requireRankingAdmin(request);
    const { projectId, operationId } = await params;
    return rankingReply(
      await rankingOperation(projectId, operationId, admin.id),
    );
  } catch (error) {
    return rankingError(error);
  }
}
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ projectId: string; operationId: string }> },
) {
  try {
    const admin = await requireRankingAdmin(request);
    const { projectId, operationId } = await params;
    const { requireRankingProject, rankingUuid } = await import(
      "@/lib/ranking-access"
    );
    await requireRankingProject(projectId, admin.id);
    rankingUuid(operationId);
    const {cancelRankingVercelUpload}=await import("@/lib/ranking-vercel");
    await cancelRankingVercelUpload(projectId,operationId);
    const { getDb } = await import("@/lib/db");
    const { HttpError } = await import("@/lib/http");
    await getDb().begin(async (tx) => {
      const rows =
        await tx`select o.id,o.source_id,o.status,s.status as source_status from shorts_mvp.ranking_operations o join shorts_mvp.ranking_sources s on s.id=o.source_id where o.id=${operationId} and o.project_id=${projectId} and o.action='import' for update of o,s`;
      const row = rows[0];
      if (!row) throw new HttpError(404, "업로드 작업이 없습니다.");
      if (row.status === "failed") return;
      if (row.status !== "queued" || row.sourceStatus !== "uploading")
        throw new HttpError(409, "업로드가 완료되어 처리 중입니다.");
      await tx`update shorts_mvp.ranking_sources set status='failed',error='업로드가 중단되었습니다.' where id=${row.sourceId}`;
      await tx`update shorts_mvp.ranking_operations set status='failed',error='업로드가 중단되었습니다.',finished_at=now(),updated_at=now() where id=${operationId}`;
    });
    return rankingReply({ ok: true });
  } catch (error) {
    return rankingError(error);
  }
}
