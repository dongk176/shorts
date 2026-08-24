import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  getFileUploadReleaseAccess,
  lockFileUploadReleaseAccess,
} from "@/lib/file-upload-release";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { getUsageSnapshot } from "@/lib/usage";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

function hiddenNotFound() {
  return new HttpError(404, "찾을 수 없습니다.", "NOT_FOUND");
}

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

async function requireHiddenAuthenticatedSession() {
  try {
    const session = await requireAuthenticatedMvpSession();
    if (!session.id || !session.userId) throw hiddenNotFound();
    return session;
  } catch {
    throw hiddenNotFound();
  }
}

export async function GET() {
  return noStore(apiError(hiddenNotFound()));
}

export async function DELETE(_: Request, context: RouteContext) {
  try {
    const session = await requireHiddenAuthenticatedSession();
    const { sessionId: rawSessionId } = await context.params;
    const parsedSessionId = z.string().uuid().safeParse(rawSessionId);
    if (!parsedSessionId.success) throw hiddenNotFound();

    const db = getDb();
    const access = await getFileUploadReleaseAccess(db, session.userId);
    if (!access.adminEnabled) throw hiddenNotFound();

    const result = await db.begin(async (tx) => {
      await tx`
        select pg_advisory_xact_lock(hashtextextended(${session.userId},0))
      `;
      const lockedAccess = await lockFileUploadReleaseAccess(tx, session.userId);
      if (!lockedAccess.adminEnabled) throw hiddenNotFound();

      // This lock serializes browser cancellation against the receiver's
      // atomic awaiting_upload -> claimed transition. Once claimed, cleanup
      // belongs to the receiver and the browser must not finalize the job.
      const rows = await tx`
        select
          upload.id as upload_session_id,
          upload.job_id,
          upload.status,
          upload.consumed_at,
          job.project_number
        from shorts_mvp.upload_sessions upload
        join shorts_mvp.video_jobs job on job.id=upload.job_id
        where upload.id=${parsedSessionId.data}
          and upload.user_id=${session.userId}
          and job.user_id=${session.userId}
          and job.source_type='upload'
          and job.execution_backend='upload_service'
        limit 1
        for update of upload,job
      `;
      const upload = rows[0];
      if (!upload) throw hiddenNotFound();

      if (upload.status === "cancelled") {
        return {
          uploadSessionId: String(upload.uploadSessionId),
          jobId: String(upload.jobId),
          projectNumber: Number(upload.projectNumber),
          alreadyCancelled: true,
        };
      }
      if (upload.status === "claimed" || upload.consumedAt) {
        throw new HttpError(
          409,
          "원본 업로드 처리가 이미 시작되었습니다.",
          "FILE_UPLOAD_ALREADY_CLAIMED",
        );
      }
      if (upload.status !== "awaiting_upload") {
        throw new HttpError(
          409,
          "현재 상태에서는 업로드를 취소할 수 없습니다.",
          "FILE_UPLOAD_NOT_CANCELLABLE",
        );
      }

      await tx`
        update shorts_mvp.upload_sessions
        set status='cancelled',
            failure_code='client_upload_aborted',
            failure_reason='원본 업로드가 시작되기 전에 취소되었습니다.',
            source_deleted_at=coalesce(source_deleted_at,clock_timestamp()),
            completed_at=coalesce(completed_at,clock_timestamp())
        where id=${parsedSessionId.data} and status='awaiting_upload'
      `;
      await tx`
        select * from shorts_mvp.finalize_project_job(
          ${upload.jobId},
          'upload_cancelled',
          '원본 업로드가 취소되었습니다.'
        )
      `;

      return {
        uploadSessionId: String(upload.uploadSessionId),
        jobId: String(upload.jobId),
        projectNumber: Number(upload.projectNumber),
        alreadyCancelled: false,
      };
    });

    const usage = await getUsageSnapshot(db, session);
    return noStore(NextResponse.json({
      ...result,
      cancelled: true,
      status: "cancelled",
      usage,
    }));
  } catch (error) {
    return noStore(apiError(error));
  }
}
