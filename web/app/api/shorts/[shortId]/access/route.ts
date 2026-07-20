import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { requireMvpSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ shortId: string }> }) {
  try {
    const { shortId } = await context.params;
    const session = await requireMvpSession();
    const db = getDb();
    const rows = await db`
      select s.output_s3_key, s.expires_at, s.render_version
      from shorts_mvp.generated_shorts s
      join shorts_mvp.video_jobs j on j.id=s.job_id
      where s.id=${shortId} and (
        j.is_example
        or (${session.userId}::uuid is not null and s.user_id=${session.userId})
        or (${session.userId}::uuid is null and s.user_id is null and s.mvp_session_id=${session.id})
      )
        and s.status in ('ready', 'rerendering') and s.deleted_at is null
        and (s.expires_at is null or s.expires_at > now())
    `;
    if (!rows[0]) throw new Error("접근할 수 있는 쇼츠를 찾을 수 없습니다.");
    const domain = process.env.CLOUDFRONT_DOMAIN;
    const keyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID;
    const privateKeyB64 = process.env.CLOUDFRONT_PRIVATE_KEY_B64;
    const privateKeyPath = process.env.CLOUDFRONT_PRIVATE_KEY_PATH;
    let privateKey = privateKeyB64
      ? Buffer.from(privateKeyB64, "base64").toString("utf8")
      : "";
    if (!privateKey && privateKeyPath) {
      privateKey = await readFile(path.resolve(process.cwd(), privateKeyPath), "utf8");
    }
    if (!domain || !keyPairId || !privateKey) {
      throw new Error("CloudFront Signed URL 설정이 완료되지 않았습니다.");
    }
    const expiresAt = rows[0].expiresAt as Date | null;
    const signedUntil = new Date(expiresAt
      ? Math.min(Date.now() + 15 * 60_000, expiresAt.getTime())
      : Date.now() + 15 * 60_000);
    const url = getSignedUrl({
      url: `https://${domain}/${rows[0].outputS3Key}`,
      keyPairId,
      privateKey,
      dateLessThan: signedUntil.toISOString(),
    });
    return NextResponse.json({ url, expiresAt: signedUntil.toISOString(), renderVersion: rows[0].renderVersion });
  } catch (error) { return apiError(error); }
}
