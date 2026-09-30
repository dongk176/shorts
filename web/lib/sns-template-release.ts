import type { Sql, TransactionSql } from "postgres";
import { HttpError } from "./http";
import { languageTestRegistrySchema } from "./language-test";

// A separate immutable release: never repoint the public language settings.
export const SNS_TEMPLATE_RELEASE_ID = "b871796a-f83a-4aed-8d56-bf039de1cdbf";
export const SNS_TEMPLATE_UNAVAILABLE = "SNS 템플릿을 준비 중입니다. 잠시 후 다시 시도해 주세요.";

export async function snsTemplateRelease(db: Sql | TransactionSql) {
  const [row] = await db`
    select r.id,r.registry::text as registry_json,r.verified_at,
      e.git_sha,e.worker_image_digest,e.font_manifest_sha256,e.status,e.ui_version,
      e.document_version,e.staging_verified_at,e.render_spec_version,e.caption_render_spec_version
    from shorts_mvp.language_test_releases r join shorts_mvp.editor_releases e on e.id=r.id
    where r.id=${SNS_TEMPLATE_RELEASE_ID}
    for share of r,e
  `;
  let value: unknown;
  try { value = JSON.parse(row?.registryJson ?? "null"); } catch { value = null; }
  const result = languageTestRegistrySchema.safeParse(value);
  if (!row?.verifiedAt || !row.stagingVerifiedAt || !result.success
    || !["canary_ready", "canary_active", "approved"].includes(row.status)
    || row.uiVersion !== 3 || row.documentVersion !== 3
    || row.renderSpecVersion !== 4 || row.captionRenderSpecVersion !== 4
    || !Object.values(result.data.lanes).every(({ current: t }) =>
      t.releaseId.startsWith("sns-template-") && t.workerSourceGitSha === row.gitSha
      && t.imageUri.endsWith(`@${row.workerImageDigest}`) && t.fontManifestSha256 === row.fontManifestSha256)) {
    throw new HttpError(503, SNS_TEMPLATE_UNAVAILABLE, "SNS_TEMPLATE_UNAVAILABLE");
  }
  return { releaseId: row.id as string, registry: result.data };
}

export async function lockSnsTemplateAdmission(db: TransactionSql, userId: string | null) {
  const [user] = await db`select id from shorts_mvp.app_users where id=${userId} for share`;
  if (!user?.id) throw new HttpError(401, "로그인 후 SNS 템플릿을 이용해 주세요.", "AUTH_REQUIRED");
  return snsTemplateRelease(db);
}
