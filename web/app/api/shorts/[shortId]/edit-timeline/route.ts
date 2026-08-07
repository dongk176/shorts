import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getBillingSummary } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { assertPaidProjectActionAccess } from "@/lib/project-action-entitlements";
import { rangeEditingEnabled } from "@/lib/range-editing";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ shortId: string }> }) {
  try {
    if (!rangeEditingEnabled()) throw new HttpError(404, "편집 타임라인을 찾을 수 없습니다.");
    const { shortId } = await context.params;
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const billing = await getBillingSummary(db, session.userId);
    assertPaidProjectActionAccess(billing, "edit");
    const rows = await db`
      select s.edit_timeline_s3_key, s.clean_clip_s3_key,
        s.edit_timeline_start_seconds,
        s.edit_timeline_end_seconds, s.edit_timeline_subtitle_segments,
        s.edit_timeline_version, s.start_seconds, s.end_seconds,
        s.initial_start_seconds, s.initial_end_seconds, s.subtitle_segments,
        s.expires_at
      from shorts_mvp.generated_shorts s
      join shorts_mvp.video_jobs j on j.id=s.job_id
      where s.id=${shortId} and not j.is_example and (
        (${session.userId}::uuid is not null and s.user_id=${session.userId})
        or (${session.userId}::uuid is null and s.user_id is null and s.mvp_session_id=${session.id})
      ) and s.status='ready' and s.deleted_at is null and s.expires_at > now()
        and s.output_s3_key is not null
        and coalesce(s.edit_timeline_s3_key,s.clean_clip_s3_key) is not null
    `;
    if (!rows[0]) throw new HttpError(404, "이 쇼츠에는 편집 가능한 영상이 없습니다.");

    const row = rows[0];
    const hasCapturedTimeline = Boolean(row.editTimelineS3Key);
    const sourceKey = hasCapturedTimeline
      ? String(row.editTimelineS3Key)
      : String(row.cleanClipS3Key);
    const domain = process.env.CLOUDFRONT_DOMAIN;
    const keyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID;
    const privateKeyB64 = process.env.CLOUDFRONT_PRIVATE_KEY_B64;
    const privateKeyPath = process.env.CLOUDFRONT_PRIVATE_KEY_PATH;
    let privateKey = privateKeyB64 ? Buffer.from(privateKeyB64, "base64").toString("utf8") : "";
    if (!privateKey && privateKeyPath) {
      privateKey = await readFile(path.resolve(process.cwd(), privateKeyPath), "utf8");
    }
    if (!domain || !keyPairId || !privateKey) {
      throw new Error("CloudFront Signed URL 설정이 완료되지 않았습니다.");
    }
    const expiresAt = row.expiresAt as Date;
    const signedUntil = new Date(Math.min(Date.now() + 15 * 60_000, expiresAt.getTime()));
    const url = getSignedUrl({
      url: `https://${domain}/${sourceKey}`,
      keyPairId,
      privateKey,
      dateLessThan: signedUntil.toISOString(),
    });
    const currentStartSeconds = Number(row.startSeconds);
    const currentEndSeconds = Number(row.endSeconds);
    return NextResponse.json({
      url,
      timelineStartSeconds: hasCapturedTimeline
        ? Number(row.editTimelineStartSeconds)
        : currentStartSeconds,
      timelineEndSeconds: hasCapturedTimeline
        ? Number(row.editTimelineEndSeconds)
        : currentEndSeconds,
      currentStartSeconds,
      currentEndSeconds,
      initialStartSeconds: hasCapturedTimeline
        ? Number(row.initialStartSeconds)
        : currentStartSeconds,
      initialEndSeconds: hasCapturedTimeline
        ? Number(row.initialEndSeconds)
        : currentEndSeconds,
      subtitleSegments: hasCapturedTimeline
        ? row.editTimelineSubtitleSegments || []
        : row.subtitleSegments || [],
      version: hasCapturedTimeline ? Number(row.editTimelineVersion) : 0,
      canExtendSelection: hasCapturedTimeline,
      expiresAt: signedUntil.toISOString(),
    });
  } catch (error) {
    return apiError(error);
  }
}
