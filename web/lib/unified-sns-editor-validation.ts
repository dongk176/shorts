import type { ValidatedEditorDocumentSnapshot } from "./editor-document-contract";
import type { EditorReleaseAssignment } from "./editor-rendering-release";
import type { VideoAspectRatio } from "./contracts";
import { HttpError } from "./http";
import type { TransactionSql } from "postgres";
import {
  isUnifiedSnsSnapshot, unifiedSnsSnapshot, unifiedSnsTemplate,
  UNIFIED_COMMUNITY_EDITOR_RELEASE_ID, UNIFIED_SNS_EDITOR_RELEASE_ID
} from "./unified-sns-editor";

/** Dedicated social workers do not participate in the ordinary editor's
 * global five-lane registration. Require their own exact-image design probe. */
export async function assertUnifiedSnsDesignRelease(tx: TransactionSql, releaseId: string) {
  const [row] = await tx`
    select e.id,e.git_sha,e.worker_image_digest,e.font_manifest_sha256,c.details::text as details_json
    from shorts_mvp.editor_releases e join shorts_mvp.editor_release_checks c on c.release_id=e.id
    where e.id=${releaseId} and c.environment='isolated' and c.check_name='sns_editor_compatibility'
      and c.status='passed' and c.completed_at is not null
      and e.status in ('canary_ready','canary_active','approved') and e.staging_verified_at is not null
      and e.ui_version=3 and e.document_version=3 and e.render_spec_version=4 and e.caption_render_spec_version=4
    for share of e,c
  `;
  let proof;
  try { proof = JSON.parse(row?.detailsJson || "null"); } catch { proof = null; }
  const probe = proof?.unifiedSocialProbe;
  const design = probe?.customTemplateDesign;
  const verification = design?.verification;
  if (!row || ![UNIFIED_SNS_EDITOR_RELEASE_ID, UNIFIED_COMMUNITY_EDITOR_RELEASE_ID].includes(row.id)
    || proof?.unifiedTemplateEditorVersion !== 1 || proof?.sourceGitSha !== row.gitSha
    || proof?.imageDigest !== row.workerImageDigest || proof?.fontManifestSha256 !== row.fontManifestSha256
    || probe?.version !== 1 || probe?.runtimeIdentityVerified !== true || probe?.batchStatus !== "SUCCEEDED"
    || probe?.sourceGitSha !== row.gitSha || probe?.imageDigest !== row.workerImageDigest
    || probe?.fontManifestSha256 !== row.fontManifestSha256
    || !/^[a-f0-9]{64}$/.test(String(probe?.manifestSha256)) || !probe?.manifestS3VersionId
    || !/^s3:\/\/[^/]+\/outputs\/unified-social-verification\//.test(String(probe?.artifactUri))
    || proof?.browserVerification?.desktop !== true || proof?.browserVerification?.mobile !== true
    || proof?.browserVerification?.sourceGitSha !== row.gitSha
    || !Array.isArray(probe?.cases) || probe.cases.length !== 2
    || !probe.cases.some((c: {kind?: string}) => c.kind === "sns")
    || !probe.cases.some((c: {kind?: string; subtitles?: boolean}) => c.kind === "community" && c.subtitles === true)
    || design?.version !== 1 || design?.passed !== true || design?.wrapRevision !== "editor-text-v1"
    || design?.sourceGitSha !== row.gitSha || design?.workerImageDigest !== row.workerImageDigest
    || design?.fontManifestSha256 !== row.fontManifestSha256
    || design?.renderSpecVersion !== 4 || design?.captionRenderSpecVersion !== 4
    || verification?.caseCount !== 3 || verification?.textOverlayCount !== 20
    || verification?.deletedTextPreserved !== true
    || typeof verification?.maximumFrameMeanError !== "number"
    || !Number.isFinite(verification.maximumFrameMeanError) || verification.maximumFrameMeanError > 2
    || !Array.isArray(verification?.fontIds) || new Set(verification.fontIds).size !== 20) {
    throw new HttpError(503, "배경·텍스트 렌더 검증을 준비 중입니다. 잠시 후 다시 시도해 주세요.", "CUSTOM_TEMPLATE_DESIGN_RENDER_UNAVAILABLE");
  }
}

/** Only the new, attested worker can accept movable social layers. The base
 * layout and immutable language/template identity always come from storage;
 * editable geometry, copy and image ownership use the common editor validators. */
export function validateUnifiedSnsEdit(document: ValidatedEditorDocumentSnapshot, original: Record<string, unknown>,
  ratio: VideoAspectRatio, release: EditorReleaseAssignment) {
  const community = original.communityTemplateVersion === 1;
  const snapshot = document.template.snapshot;
  if (original.snsTemplateVersion !== 1 || !isUnifiedSnsSnapshot(snapshot)
    || !release.unifiedTemplateEditingCapable
    || release.releaseId !== (community ? UNIFIED_COMMUNITY_EDITOR_RELEASE_ID : UNIFIED_SNS_EDITOR_RELEASE_ID)
    || document.version !== 3 || document.renderSpec.version !== 4
    || document.template.id !== "white-yellow" || document.template.customTemplateId !== null
    || snapshot?.snsLanguage !== original.snsLanguage
    || (snapshot?.communityTemplateVersion === 1) !== community
    || !/^#[0-9a-f]{6}$/i.test(String(snapshot?.brandColor))
    || document.video.aspectRatio !== ratio) {
    throw new HttpError(400, "편집 화면을 새로 열고 다시 저장해 주세요.", "SNS_EDITOR_DOCUMENT_INVALID");
  }
  const layout = unifiedSnsTemplate({ templateSnapshot: { ...original, brandColor: snapshot?.brandColor }, videoAspectRatio: ratio });
  if (!layout) throw new HttpError(400, "템플릿 정보를 확인할 수 없습니다.");
  // Ignore client-supplied base config/identity. All user changes live in the
  // already validated overlay/document fields, including uploaded backgrounds.
  return unifiedSnsSnapshot(original, layout.config, document.title.text, document.overlays.textOverlays, String(snapshot?.brandColor));
}
