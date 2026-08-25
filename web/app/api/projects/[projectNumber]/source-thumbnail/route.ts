import { NextResponse } from "next/server";
import { getProjectSourceThumbnailUrl } from "@/lib/aws";
import { getDb } from "@/lib/db";
import { assertEnterpriseSessionServiceAccess } from "@/lib/enterprise-access";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ projectNumber: string }>;
};

function hiddenNotFound() {
  return new HttpError(404, "찾을 수 없습니다.", "NOT_FOUND");
}

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

async function requireHiddenOwnerSession() {
  try {
    const session = await requireAuthenticatedMvpSession({
      allowPaymentMethodRemediation: true,
      createIfMissing: false,
    });
    await assertEnterpriseSessionServiceAccess(getDb(), session);
    if (!session.userId) throw hiddenNotFound();
    return session;
  } catch {
    throw hiddenNotFound();
  }
}

function parseProjectNumber(value: string) {
  if (!/^[1-9]\d*$/.test(value)) throw hiddenNotFound();
  const projectNumber = Number(value);
  if (!Number.isSafeInteger(projectNumber)) throw hiddenNotFound();
  return projectNumber;
}

const uuidPattern = (
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
);
const thumbnailLeafPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.jpg$/;

function isBoundSourceThumbnailKey({
  key,
  mvpSessionId,
  jobId,
}: {
  key: string;
  mvpSessionId: string;
  jobId: string;
}) {
  if (!uuidPattern.test(mvpSessionId) || !uuidPattern.test(jobId)) return false;
  const prefix = `thumbnails/${mvpSessionId}/${jobId}/`;
  if (!key.startsWith(prefix)) return false;
  return thumbnailLeafPattern.test(key.slice(prefix.length));
}

export async function GET(_: Request, context: RouteContext) {
  try {
    const session = await requireHiddenOwnerSession();
    const { projectNumber: rawProjectNumber } = await context.params;
    const projectNumber = parseProjectNumber(rawProjectNumber);
    const db = getDb();
    const rows = await db`
      select
        job.id as job_id,
        job.mvp_session_id,
        job.expires_at,
        upload.source_thumbnail_s3_key
      from shorts_mvp.video_jobs job
      join shorts_mvp.upload_sessions upload
        on upload.job_id=job.id
        and upload.user_id=job.user_id
        and upload.mvp_session_id=job.mvp_session_id
      where job.project_number=${projectNumber}
        and job.user_id=${session.userId}
        and job.source_type='upload'
        and job.execution_backend='upload_service'
        and not job.is_example
        and job.user_deleted_at is null
        and (job.expires_at is null or job.expires_at>clock_timestamp())
        and upload.status in ('claimed','completed','failed')
        and upload.received_bytes=upload.expected_bytes
        and upload.probe_metadata is not null
        and upload.source_thumbnail_s3_key is not null
      limit 1
    `;
    const row = rows[0];
    if (!row) throw hiddenNotFound();

    const key = String(row.sourceThumbnailS3Key || "");
    const mvpSessionId = String(row.mvpSessionId || "");
    const jobId = String(row.jobId || "");
    if (!isBoundSourceThumbnailKey({ key, mvpSessionId, jobId })) {
      throw hiddenNotFound();
    }

    const url = await getProjectSourceThumbnailUrl({
      key,
      expiresAt: (row.expiresAt as Date | string | null | undefined) ?? null,
    });
    const response = NextResponse.redirect(url, 307);
    response.headers.set("Referrer-Policy", "no-referrer");
    return noStore(response);
  } catch (error) {
    return noStore(apiError(error));
  }
}
