import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getBillingSummary } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { assertPaidProjectActionAccess } from "@/lib/project-action-entitlements";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const editorAssetKeyPattern = (
  /^edit-sources\/[A-Za-z0-9/_-]+\/editor-assets\/[A-Za-z0-9_-]+\.(png|jpg|webp)$/
);

export async function GET(
  _: Request,
  context: { params: Promise<{ shortId: string }> },
) {
  try {
    const { shortId } = await context.params;
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const billing = await getBillingSummary(db, session.userId);
    assertPaidProjectActionAccess(billing, "edit");
    const rows = await db`
      select
        s.editor_document->'channel'->>'thumbnailAssetKey' as asset_key,
        s.expires_at
      from shorts_mvp.generated_shorts s
      join shorts_mvp.video_jobs j on j.id=s.job_id
      where s.id=${shortId} and not j.is_example
        and s.user_id=${session.userId}
        and s.status in ('ready','rerendering')
        and s.deleted_at is null and s.expires_at>clock_timestamp()
      limit 1
    `;
    const assetKey = String(rows[0]?.assetKey || "");
    if (!editorAssetKeyPattern.test(assetKey)) {
      throw new HttpError(404, "저장된 채널 이미지를 찾을 수 없습니다.");
    }
    const domain = process.env.CLOUDFRONT_DOMAIN;
    const keyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID;
    const privateKeyB64 = process.env.CLOUDFRONT_PRIVATE_KEY_B64;
    const privateKeyPath = process.env.CLOUDFRONT_PRIVATE_KEY_PATH;
    let privateKey = privateKeyB64
      ? Buffer.from(privateKeyB64, "base64").toString("utf8")
      : "";
    if (!privateKey && privateKeyPath) {
      privateKey = await readFile(
        path.resolve(process.cwd(), privateKeyPath),
        "utf8",
      );
    }
    if (!domain || !keyPairId || !privateKey) {
      throw new Error("CloudFront Signed URL 설정이 완료되지 않았습니다.");
    }
    const expiresAt = rows[0].expiresAt as Date;
    const signedUntil = new Date(
      Math.min(Date.now() + 15 * 60_000, expiresAt.getTime()),
    );
    return NextResponse.redirect(getSignedUrl({
      url: `https://${domain}/${assetKey}`,
      keyPairId,
      privateKey,
      dateLessThan: signedUntil.toISOString(),
    }), 307);
  } catch (error) {
    return apiError(error);
  }
}
