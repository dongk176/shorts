import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getBillingSummary } from "@/lib/billing";
import { getDb } from "@/lib/db";
import {
  subtitleEditingReleaseEnabled,
  resolveEditorRelease,
} from "@/lib/editor-rendering-release";
import { apiError, HttpError } from "@/lib/http";
import { assertPaidProjectActionAccess } from "@/lib/project-action-entitlements";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { getSubtitleTemplateAccess } from "@/lib/subtitle-template-release";
import {
  assertUnifiedTemplateSubtitleCanaryAccess,
  isUnifiedTemplateSubtitleSnapshot,
} from "@/lib/template-execution-snapshot";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ shortId: string }> }) {
  try {
    const { shortId } = await context.params;
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const billing = await getBillingSummary(db, session.userId);
    assertPaidProjectActionAccess(billing, "edit");
    const rows = await db`
      select s.clean_clip_s3_key, s.expires_at, s.subtitle_template_id,
        s.subtitle_template_snapshot
      from shorts_mvp.generated_shorts s
      join shorts_mvp.video_jobs j on j.id=s.job_id
      where s.id=${shortId} and not j.is_example
        and j.user_deleted_at is null and (
        (${session.userId}::uuid is not null and s.user_id=${session.userId})
        or (${session.userId}::uuid is null and s.user_id is null and s.mvp_session_id=${session.id})
      )
        and s.status in ('ready', 'rerendering') and s.deleted_at is null and s.expires_at > now()
    `;
    if (!rows[0]) throw new Error("편집용 영상을 찾을 수 없습니다.");
    if (rows[0].subtitleTemplateId) {
      if (!subtitleEditingReleaseEnabled(
        await resolveEditorRelease(db, session.userId),
      )) {
        throw new HttpError(
          409,
          "자막 템플릿으로 만든 영상은 아직 편집할 수 없습니다.",
          "SUBTITLE_TEMPLATE_EDIT_UNSUPPORTED",
        );
      }
      if (isUnifiedTemplateSubtitleSnapshot(rows[0].subtitleTemplateSnapshot)) {
        assertUnifiedTemplateSubtitleCanaryAccess(
          await getSubtitleTemplateAccess(db, session.userId),
        );
      }
    }
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
