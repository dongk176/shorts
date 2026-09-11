import { getBillingSummary } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { assertEnterpriseSessionServiceAccess } from "@/lib/enterprise-access";
import { apiError, HttpError } from "@/lib/http";
import { assertPaidProjectActionAccess } from "@/lib/project-action-entitlements";
import { projectDownloadArchive, type ProjectDownloadItem } from "@/lib/project-download-archive";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Context = { params: Promise<{ projectNumber: string }> };
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
};

async function downloadItems(context: Context) {
  const { projectNumber: raw } = await context.params;
  const projectNumber = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(projectNumber)) {
    throw new HttpError(400, "프로젝트 번호를 확인해 주세요.");
  }
  const session = await requireAuthenticatedMvpSession();
  const db = getDb();
  await assertEnterpriseSessionServiceAccess(db, session);
  const billing = await getBillingSummary(db, session.userId);
  assertPaidProjectActionAccess(billing, "download");
  const rows = await db`
    select s.output_s3_key,s.hook_title,s.expires_at
    from shorts_mvp.generated_shorts s
    join shorts_mvp.video_jobs j on j.id=s.job_id
    where j.project_number=${projectNumber}
      and j.user_deleted_at is null
      and j.is_example=false
      and (
        (${session.userId}::uuid is not null and s.user_id=${session.userId})
        or (
          ${session.userId}::uuid is null
          and s.user_id is null
          and s.mvp_session_id=${session.id}
        )
      )
      and s.status='ready'
      and s.output_s3_key is not null
      and s.deleted_at is null
      and (s.expires_at is null or s.expires_at > now())
    order by s.clip_index,s.id
  `;
  if (!rows.length) {
    throw new HttpError(404, "다운로드할 수 있는 쇼츠를 찾을 수 없습니다.");
  }
  const items: ProjectDownloadItem[] = rows.map((row) => ({
    outputS3Key: String(row.outputS3Key),
    hookTitle: String(row.hookTitle || ""),
    expiresAt: row.expiresAt as Date | string | null,
  }));
  return { projectNumber, items };
}

function downloadError(error: unknown) {
  console.error("project_download_failed", {
    code: error instanceof HttpError ? error.code : "DOWNLOAD_FAILED",
  });
  const response = apiError(error, "쇼츠를 다운로드하지 못했습니다. 다시 시도해 주세요.");
  for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
  return response;
}

// The button can report access/expiry errors without leaving the project page.
export async function HEAD(_: Request, context: Context) {
  try {
    const { items } = await downloadItems(context);
    return new Response(null, {
      headers: { ...privateHeaders, "X-Shorts-Count": String(items.length) },
    });
  } catch (error) {
    const response = downloadError(error);
    return new Response(null, { status: response.status, headers: response.headers });
  }
}

export async function GET(request: Request, context: Context) {
  try {
    // Recheck access on the actual download, even after a successful HEAD.
    const { projectNumber, items } = await downloadItems(context);
    const archive = await projectDownloadArchive(items, request.signal);
    return new Response(archive, {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="easycut-project-${projectNumber}.zip"`,
        "X-Content-Type-Options": "nosniff",
        "X-Shorts-Count": String(items.length),
      },
    });
  } catch (error) {
    return downloadError(error);
  }
}
