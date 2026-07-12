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
      select clean_clip_s3_key, expires_at
      from shorts_mvp.generated_shorts
      where id=${shortId} and mvp_session_id=${session.id}
        and status in ('ready', 'rerendering') and deleted_at is null and expires_at > now()
    `;
    if (!rows[0]) throw new Error("편집용 영상을 찾을 수 없습니다.");
    const domain = process.env.CLOUDFRONT_DOMAIN;
    const keyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID;
    const privateKeyB64 = process.env.CLOUDFRONT_PRIVATE_KEY_B64;
    const privateKeyPath = process.env.CLOUDFRONT_PRIVATE_KEY_PATH;
    let privateKey = privateKeyB64 ? Buffer.from(privateKeyB64, "base64").toString("utf8") : "";
    if (!privateKey && privateKeyPath) privateKey = await readFile(path.resolve(process.cwd(), privateKeyPath), "utf8");
    if (!domain || !keyPairId || !privateKey) throw new Error("CloudFront Signed URL 설정이 완료되지 않았습니다.");
    const expiresAt = rows[0].expiresAt as Date;
    const signedUntil = new Date(Math.min(Date.now() + 15 * 60_000, expiresAt.getTime()));
    const url = getSignedUrl({
      url: `https://${domain}/${rows[0].cleanClipS3Key}`,
      keyPairId,
      privateKey,
      dateLessThan: signedUntil.toISOString(),
    });
    return NextResponse.json({ url, expiresAt: signedUntil.toISOString() });
  } catch (error) { return apiError(error); }
}
