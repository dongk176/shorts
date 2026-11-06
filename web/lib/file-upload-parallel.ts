import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { HttpError } from "./http";

/** Resolve from the immutable, owner-bound job, never a client URL or current
 * rollout setting. Retried/cancelled old sessions keep their original service. */
export async function uploadCapacityFunctionForJob(db: Sql | TransactionSql, jobId: string, userId: string) {
  const [row] = await db`select j.silence_inline_release_id,r.capacity_function_arn
    from shorts_mvp.video_jobs j left join shorts_mvp.silence_upload_routes r
      on r.release_id=j.silence_inline_release_id
    where j.id=${jobId} and j.user_id=${userId} and j.source_type='upload'`;
  if (!row?.silenceInlineReleaseId) return undefined;
  if (!/^arn:aws:lambda:ap-northeast-2:181651591905:function:shorts-upload-candidate-[a-z0-9-]+$/.test(row.capacityFunctionArn ?? "")) {
    throw new HttpError(503, "업로드 처리 경로를 확인하지 못했습니다.", "UPLOAD_ROUTE_UNAVAILABLE");
  }
  return String(row.capacityFunctionArn);
}

export async function parallelUploadAvailable(db: Sql | TransactionSql, userId?: string, releaseId?: string) {
  const configured = process.env.FILE_UPLOAD_PARALLEL_RELEASE_ID;
  if (!userId || !configured || process.env.FILE_UPLOAD_CANDIDATE_RELEASE_ID
    || configured !== process.env.SHORTS_SILENCE_PARALLEL_RELEASE_ID
    || (releaseId && releaseId !== configured)) return false;
  const [row] = await db`select r.release_id from shorts_mvp.silence_upload_routes r
    join shorts_mvp.shorts_silence_routing q on q.release_id=r.release_id and q.singleton and q.enabled
    join shorts_mvp.app_users u on u.id=${userId} and u.withdrawn_at is null
    left join shorts_mvp.silence_upload_acceptance a on a.release_id=r.release_id
    where r.release_id=${configured}
      and ((u.is_admin and r.administrator_id=u.id) or (a.release_id is not null
        and shorts_mvp.silence_rollout_bucket(u.id,r.release_id)<q.percentage))`;
  return !!row;
}
