import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { rangeEditingEnabled } from "@/lib/range-editing";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ shortId: string }> }) {
  try {
    if (!rangeEditingEnabled()) throw new HttpError(404, "편집 타임라인을 찾을 수 없습니다.");
    const { shortId } = await context.params;
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const rows = await db`
      select s.edit_timeline_s3_key, s.edit_timeline_start_seconds,
        s.edit_timeline_end_seconds, s.edit_timeline_subtitle_segments,
        s.edit_timeline_version, s.start_seconds, s.end_seconds,
        s.initial_start_seconds, s.initial_end_seconds, s.expires_at
      from shorts_mvp.generated_shorts s
      join shorts_mvp.video_jobs j on j.id=s.job_id
      where s.id=${shortId} and not j.is_example and (
        (${session.userId}::uuid is not null and s.user_id=${session.userId})
        or (${session.userId}::uuid is null and s.user_id is null and s.mvp_session_id=${session.id})
      ) and s.status='ready' and s.deleted_at is null and s.expires_at > now()
        and s.output_s3_key is not null and s.edit_timeline_s3_key is not null
    `;
    if (!rows[0]) throw new HttpError(404, "이 쇼츠에는 편집 가능한 여유 영상이 없습니다.");

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
    const expiresAt = rows[0].expiresAt as Date;
    const signedUntil = new Date(Math.min(Date.now() + 15 * 60_000, expiresAt.getTime()));
    const url = getSignedUrl({
      url: `https://${domain}/${rows[0].editTimelineS3Key}`,
      keyPairId,
      privateKey,
      dateLessThan: signedUntil.toISOString(),
    });
    return NextResponse.json({
      url,
      timelineStartSeconds: Number(rows[0].editTimelineStartSeconds),
      timelineEndSeconds: Number(rows[0].editTimelineEndSeconds),
      currentStartSeconds: Number(rows[0].startSeconds),
      currentEndSeconds: Number(rows[0].endSeconds),
      initialStartSeconds: Number(rows[0].initialStartSeconds),
      initialEndSeconds: Number(rows[0].initialEndSeconds),
      subtitleSegments: rows[0].editTimelineSubtitleSegments || [],
      version: Number(rows[0].editTimelineVersion),
      expiresAt: signedUntil.toISOString(),
    });
  } catch (error) {
    return apiError(error);
  }
}
