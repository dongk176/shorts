import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  ensureFileUploadCapacity,
  getFileUploadCapacityStatus,
  releaseFileUploadCapacity,
} from "@/lib/aws";
import { assertEnterpriseSessionServiceAccess } from "@/lib/enterprise-access";
import { FileUploadCapacityTransientError } from "@/lib/file-upload-capacity-retry";
import { fileUploadSessionPublicStatus } from "@/lib/file-upload-session-state";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { getUsageSnapshot } from "@/lib/usage";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

type CapacityLeaseStatus = {
  leaseState: "waiting" | "granted" | "claimed" | "expired";
  grantedAtEpoch?: number;
  grantExpiresAtEpoch?: number;
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

export async function GET(_: Request, context: RouteContext) {
  try {
    const session = await requireHiddenAuthenticatedSession();
    const { sessionId: rawSessionId } = await context.params;
    const parsedSessionId = z.string().uuid().safeParse(rawSessionId);
    if (!parsedSessionId.success) throw hiddenNotFound();

    const db = getDb();
    await assertEnterpriseSessionServiceAccess(db, session);
    // Release mode controls new sessions only. An owner must still be able to
    // recover the authoritative state of an already-issued upload after an
    // operator pauses new traffic or the browser loses the final PUT response.
    let rows = await db`
      select upload.id as upload_session_id,upload.job_id,upload.status,
        upload.received_bytes,upload.expected_bytes,upload.expires_at,
        upload.claimed_at,upload.consumed_at,upload.completed_at,
        upload.failure_code,upload.failure_reason,upload.source_deleted_at,
        job.project_number,job.status as job_status,job.stage as job_stage,
        job.progress as job_progress
      from shorts_mvp.upload_sessions upload
      join shorts_mvp.video_jobs job on job.id=upload.job_id
      where upload.id=${parsedSessionId.data}
        and upload.user_id=${session.userId}
        and job.user_id=${session.userId}
        and job.source_type='upload'
        and job.execution_backend='upload_service'
      limit 1
    `;
    if (!rows[0]) {
      const capacityRows = await db`
        select capacity.id as upload_session_id,capacity.job_id,capacity.status,
          capacity.queue_expires_at,capacity.granted_at,
          capacity.upload_expires_at,capacity.token_hash,
          job.project_number,job.status as job_status,job.stage as job_stage,
          job.progress as job_progress
        from shorts_mvp.file_upload_capacity_requests capacity
        join shorts_mvp.video_jobs job on job.id=capacity.job_id
        where capacity.id=${parsedSessionId.data}
          and capacity.user_id=${session.userId}
          and job.user_id=${session.userId}
          and job.source_type='upload'
          and job.execution_backend='upload_service'
        limit 1
      `;
      const capacity = capacityRows[0];
      if (!capacity) throw hiddenNotFound();
      const queueExpired = new Date(capacity.queueExpiresAt).getTime() <= Date.now();
      let capacityStatus: CapacityLeaseStatus = { leaseState: "expired" };
      if (!queueExpired) {
        try {
          capacityStatus = await getFileUploadCapacityStatus(parsedSessionId.data);
        } catch (error) {
          if (!(error instanceof FileUploadCapacityTransientError)) throw error;
          console.warn(JSON.stringify({
            event: "file_upload_capacity_status_delayed",
            uploadSessionId: parsedSessionId.data,
          }));
          return noStore(NextResponse.json({
            uploadSessionId: parsedSessionId.data,
            jobId: String(capacity.jobId),
            projectNumber: Number(capacity.projectNumber),
            status: "preparing",
            receiverStatus: "waiting",
            jobStatus: String(capacity.jobStatus),
            jobStage: String(capacity.jobStage),
            jobProgress: Number(capacity.jobProgress || 0),
            receivedBytes: 0,
            expectedBytes: 0,
            received: false,
            expiresAt: null,
            preparationExpiresAt: new Date(capacity.queueExpiresAt).toISOString(),
            failureCode: null,
            failureReason: null,
            sourceDeleted: true,
          }));
        }
        if (
          capacity.status === "waiting"
          && capacityStatus.leaseState === "expired"
        ) {
          try {
            capacityStatus = await ensureFileUploadCapacity({
              desiredCount: 1,
              uploadSessionId: parsedSessionId.data,
              expiresAt: capacity.queueExpiresAt,
              tokenHash: String(capacity.tokenHash),
            });
          } catch (error) {
            if (!(error instanceof FileUploadCapacityTransientError)) throw error;
            console.warn(JSON.stringify({
              event: "file_upload_capacity_redelivery_delayed",
              uploadSessionId: parsedSessionId.data,
            }));
          }
        }
      }
      if (
        capacity.status === "waiting"
        && capacityStatus.leaseState === "granted"
        && capacityStatus.grantedAtEpoch
        && capacityStatus.grantExpiresAtEpoch
      ) {
        const grantedAt = new Date(capacityStatus.grantedAtEpoch * 1_000);
        const uploadExpiresAt = new Date(
          capacityStatus.grantExpiresAtEpoch * 1_000,
        );
        await db.begin(async (tx) => {
          await tx`
            select pg_advisory_xact_lock(
              hashtextextended(${parsedSessionId.data},0)
            )
          `;
          const promoted = await tx`
            update shorts_mvp.file_upload_capacity_requests
            set status='granted',granted_at=${grantedAt},
                upload_expires_at=${uploadExpiresAt}
            where id=${parsedSessionId.data}
              and user_id=${session.userId}
              and status='waiting'
              and queue_expires_at>clock_timestamp()
            returning *
          `;
          if (!promoted[0]) return;
          await tx`
            insert into shorts_mvp.upload_sessions (
              id,mvp_session_id,user_id,request_id,job_id,intent_hash,
              original_filename,declared_content_type,expected_bytes,
              declared_duration_seconds,declared_width,declared_height,
              declared_has_audio,range_start_seconds,range_end_seconds,
              rights_confirmed,token_hash,upload_url,expires_at
            ) select
              id,mvp_session_id,user_id,request_id,job_id,intent_hash,
              original_filename,declared_content_type,expected_bytes,
              declared_duration_seconds,declared_width,declared_height,
              declared_has_audio,range_start_seconds,range_end_seconds,
              rights_confirmed,token_hash,upload_url,${uploadExpiresAt}
            from shorts_mvp.file_upload_capacity_requests
            where id=${parsedSessionId.data}
            on conflict (id) do nothing
          `;
        });
        rows = await db`
          select upload.id as upload_session_id,upload.job_id,upload.status,
            upload.received_bytes,upload.expected_bytes,upload.expires_at,
            upload.claimed_at,upload.consumed_at,upload.completed_at,
            upload.failure_code,upload.failure_reason,upload.source_deleted_at,
            job.project_number,job.status as job_status,job.stage as job_stage,
            job.progress as job_progress
          from shorts_mvp.upload_sessions upload
          join shorts_mvp.video_jobs job on job.id=upload.job_id
          where upload.id=${parsedSessionId.data}
            and upload.user_id=${session.userId}
          limit 1
        `;
      } else if (queueExpired) {
        await db.begin(async (tx) => {
          await tx`
            update shorts_mvp.file_upload_capacity_requests
            set status='expired'
            where id=${parsedSessionId.data} and status='waiting'
          `;
          await tx`
            select * from shorts_mvp.finalize_project_job(
              ${capacity.jobId},'upload_capacity_expired',
              '업로드 시작 시간이 만료되었습니다.'
            )
          `;
        });
        await releaseFileUploadCapacity(parsedSessionId.data).catch(() => undefined);
        return noStore(NextResponse.json({
          uploadSessionId: parsedSessionId.data,
          jobId: String(capacity.jobId),
          projectNumber: Number(capacity.projectNumber),
          status: "expired",
          receiverStatus: "waiting",
          jobStatus: String(capacity.jobStatus),
          jobStage: String(capacity.jobStage),
          jobProgress: Number(capacity.jobProgress || 0),
          receivedBytes: 0,
          expectedBytes: 0,
          received: false,
          expiresAt: null,
          preparationExpiresAt: new Date(capacity.queueExpiresAt).toISOString(),
          failureCode: "upload_capacity_expired",
          failureReason: "업로드 시작 시간이 만료되었습니다.",
          sourceDeleted: true,
        }));
      } else {
        return noStore(NextResponse.json({
          uploadSessionId: parsedSessionId.data,
          jobId: String(capacity.jobId),
          projectNumber: Number(capacity.projectNumber),
          status: "preparing",
          receiverStatus: "waiting",
          jobStatus: String(capacity.jobStatus),
          jobStage: String(capacity.jobStage),
          jobProgress: Number(capacity.jobProgress || 0),
          receivedBytes: 0,
          expectedBytes: 0,
          received: false,
          expiresAt: null,
          preparationExpiresAt: new Date(capacity.queueExpiresAt).toISOString(),
          failureCode: null,
          failureReason: null,
          sourceDeleted: true,
        }));
      }
    }
    const row = rows[0];
    if (!row) throw hiddenNotFound();
    const sessionStatus = String(row.status);
    const jobStatus = String(row.jobStatus);
    const received = row.consumedAt !== null && (
      Number(row.receivedBytes || 0) === Number(row.expectedBytes || 0)
      || jobStatus !== "uploading"
    );
    const status = fileUploadSessionPublicStatus({
      receiverStatus: sessionStatus,
      jobStatus,
      received,
    });
    return noStore(NextResponse.json({
      uploadSessionId: String(row.uploadSessionId),
      jobId: String(row.jobId),
      projectNumber: Number(row.projectNumber),
      status,
      receiverStatus: sessionStatus,
      jobStatus,
      jobStage: String(row.jobStage),
      jobProgress: Number(row.jobProgress || 0),
      receivedBytes: Number(row.receivedBytes || 0),
      expectedBytes: Number(row.expectedBytes || 0),
      received,
      expiresAt: new Date(row.expiresAt).toISOString(),
      preparationExpiresAt: null,
      failureCode: row.failureCode ? String(row.failureCode) : null,
      failureReason: row.failureReason ? String(row.failureReason) : null,
      sourceDeleted: row.sourceDeletedAt !== null,
    }));
  } catch (error) {
    return noStore(apiError(error));
  }
}

export async function DELETE(_: Request, context: RouteContext) {
  try {
    const session = await requireHiddenAuthenticatedSession();
    const { sessionId: rawSessionId } = await context.params;
    const parsedSessionId = z.string().uuid().safeParse(rawSessionId);
    if (!parsedSessionId.success) throw hiddenNotFound();

    const db = getDb();
    await assertEnterpriseSessionServiceAccess(db, session);

    const result = await db.begin(async (tx) => {
      await tx`
        select pg_advisory_xact_lock(hashtextextended(${session.userId},0))
      `;
      const capacityRows = await tx`
        select
          capacity.id as upload_session_id,
          capacity.job_id,
          capacity.status,
          job.project_number
        from shorts_mvp.file_upload_capacity_requests capacity
        join shorts_mvp.video_jobs job on job.id=capacity.job_id
        where capacity.id=${parsedSessionId.data}
          and capacity.user_id=${session.userId}
          and job.user_id=${session.userId}
          and job.source_type='upload'
          and job.execution_backend='upload_service'
        limit 1
        for update of capacity,job
      `;
      const capacity = capacityRows[0];
      if (capacity?.status === "cancelled") {
        return {
          uploadSessionId: String(capacity.uploadSessionId),
          jobId: String(capacity.jobId),
          projectNumber: Number(capacity.projectNumber),
          alreadyCancelled: true,
        };
      }
      if (capacity?.status === "waiting") {
        await tx`
          update shorts_mvp.file_upload_capacity_requests
          set status='cancelled',updated_at=clock_timestamp()
          where id=${parsedSessionId.data} and status='waiting'
        `;
        await tx`
          select * from shorts_mvp.finalize_project_job(
            ${capacity.jobId},
            'upload_cancelled',
            '원본 업로드가 취소되었습니다.'
          )
        `;
        return {
          uploadSessionId: String(capacity.uploadSessionId),
          jobId: String(capacity.jobId),
          projectNumber: Number(capacity.projectNumber),
          alreadyCancelled: false,
        };
      }
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
    if (!result.alreadyCancelled) {
      await releaseFileUploadCapacity(result.uploadSessionId).catch(() => undefined);
    }
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
