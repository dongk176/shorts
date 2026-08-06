import { NextResponse } from "next/server";
import { getShortDownloadUrl } from "@/lib/aws";
import { getBillingSummary } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { assertProjectActionAccess } from "@/lib/project-action-entitlements";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import {
  shortDownloadExpirySeconds,
  shortDownloadFilename,
} from "@/lib/short-download";

export const dynamic = "force-dynamic";

export async function GET(
  _: Request,
  context: { params: Promise<{ shortId: string }> },
) {
  let requestedShortId = "unknown";
  try {
    const { shortId } = await context.params;
    requestedShortId = shortId;
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const billing = await getBillingSummary(db, session.userId);
    await assertProjectActionAccess(db, billing, session.userId, "download");
    const rows = await db`
      select s.output_s3_key,s.expires_at,s.hook_title
      from shorts_mvp.generated_shorts s
      join shorts_mvp.video_jobs j on j.id=s.job_id
      where s.id=${shortId}
        and (
          (${session.userId}::uuid is not null and s.user_id=${session.userId})
          or (
            ${session.userId}::uuid is null
            and s.user_id is null
            and s.mvp_session_id=${session.id}
          )
        )
        and j.is_example=false
        and s.status='ready'
        and s.output_s3_key is not null
        and s.deleted_at is null
        and (s.expires_at is null or s.expires_at > now())
      limit 1
    `;
    const item = rows[0];
    if (!item) throw new Error("다운로드할 수 있는 쇼츠를 찾을 수 없습니다.");

    const filename = shortDownloadFilename(String(item.hookTitle || ""));
    const url = await getShortDownloadUrl(
      String(item.outputS3Key),
      filename,
      shortDownloadExpirySeconds(item.expiresAt as Date | string | null),
    );
    const response = NextResponse.redirect(url, 307);
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    console.error("short_download_failed", {
      shortId: requestedShortId,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorCode: typeof (error as { code?: unknown })?.code === "string"
        ? (error as { code: string }).code
        : null,
      errorMessage: error instanceof Error ? error.message.slice(0, 300) : "unknown",
    });
    return apiError(error, "영상을 다운로드하지 못했습니다.");
  }
}
