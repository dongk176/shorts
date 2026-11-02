import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { HttpError } from "./http";
import { languageTestRegistrySchema } from "./language-test";
import { midformCloudEnabled } from "./midform-cloud";

export { languageTestTarget as midformTarget } from "./language-test";
export async function requireMidformAdmin(db: Sql | TransactionSql, userId: string | null) {
  const [user] = await db`select id,is_admin from shorts_mvp.app_users where id=${userId} for share`;
  if (!user || user.isAdmin !== true) throw new HttpError(404, "찾을 수 없습니다.");
}
export async function midformRelease(db: Sql | TransactionSql, userId: string | null, pinnedReleaseId?: string) {
  await requireMidformAdmin(db, userId);
  if (!midformCloudEnabled()) throw new HttpError(404, "찾을 수 없습니다.");
  const [row] = await db`select r.id,r.registry::text as registry_json,r.verified_at,
    e.git_sha,e.worker_image_digest,e.font_manifest_sha256,e.status,e.staging_verified_at,
    e.ui_version,e.document_version,e.render_spec_version,e.caption_render_spec_version
    from shorts_mvp.midform_releases r join shorts_mvp.editor_releases e on e.id=r.id
    where r.id=${pinnedReleaseId ?? process.env.MIDFORM_RELEASE_ID!} for share of r,e`;
  let raw: unknown;
  try { raw = JSON.parse(row?.registryJson ?? "null"); } catch { raw = null; }
  const parsed = languageTestRegistrySchema.safeParse(raw);
  if (!parsed.success || !row?.verifiedAt || !row.stagingVerifiedAt
    || !["canary_ready", "canary_active", "approved"].includes(row.status)
    || row.uiVersion !== 3 || row.documentVersion !== 3
    || row.renderSpecVersion !== 4 || row.captionRenderSpecVersion !== 4
    || !Object.values(parsed.data.lanes).every(({current: t}) => t.releaseId.startsWith("midform-")
      && t.workerSourceGitSha === row.gitSha && t.imageUri.endsWith(`@${row.workerImageDigest}`)
      && t.fontManifestSha256 === row.fontManifestSha256)) {
    throw new HttpError(503, "중폼 제작 서버를 준비하고 있습니다.", "MIDFORM_RELEASE_UNAVAILABLE");
  }
  return { releaseId: row.id as string, registry: parsed.data };
}


export async function midformUploadRelease(db: Sql | TransactionSql, userId: string | null) {
  const releaseId = process.env.MIDFORM_UPLOAD_RELEASE_ID;
  if (!releaseId || !/^[a-f0-9-]{36}$/.test(releaseId)) {
    throw new HttpError(503, "중폼 업로드 서버를 준비하고 있습니다.", "MIDFORM_UPLOAD_RELEASE_UNAVAILABLE");
  }
  return midformRelease(db, userId, releaseId);
}
