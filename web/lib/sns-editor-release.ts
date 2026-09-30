import { COMMUNITY_EDITOR_RELEASE_ID, COMMUNITY_TEMPLATE_RELEASE_ID } from "./community-template-contract";
import type { Sql, TransactionSql } from "postgres";
import type { EditorReleaseAssignment } from "./editor-rendering-release";
import { HttpError } from "./http";
import { SNS_EDITOR_RELEASE_ID, SNS_GENERATION_RELEASE_IDS } from "./sns-editor-contract";

/** Explicit compatibility attestation, independent of public editor pointers. */
export async function snsEditorRelease(db: Sql | TransactionSql, userId: string | null, shortId: string, community = false): Promise<EditorReleaseAssignment> {
  const [r] = await db`
    select e.id,e.ui_version,e.document_version,e.font_manifest_sha256,
      j.language_test_release_id,check_row.details
    from shorts_mvp.generated_shorts s join shorts_mvp.video_jobs j on j.id=s.job_id
    join shorts_mvp.app_users u on u.id=j.user_id
    join shorts_mvp.editor_releases e on e.id=${community ? COMMUNITY_EDITOR_RELEASE_ID : SNS_EDITOR_RELEASE_ID}
    join shorts_mvp.editor_release_checks check_row on check_row.release_id=e.id
      and check_row.environment='isolated' and check_row.check_name='sns_editor_compatibility'
      and check_row.status='passed' and check_row.completed_at is not null
    where s.id=${shortId} and s.user_id=${userId} and j.user_id=${userId}
      and (not ${community}::boolean or u.is_admin)
      and coalesce(s.template_snapshot->>'communityTemplateVersion', '0')=${community ? "1" : "0"}
      and coalesce(j.template_snapshot->>'communityTemplateVersion', '0')=${community ? "1" : "0"}
      and s.template_snapshot->>'snsTemplateVersion'='1'
      and j.template_snapshot->>'snsTemplateVersion'='1'
      and j.initial_editor_release_id=j.language_test_release_id
      and s.deleted_at is null and j.user_deleted_at is null and s.expires_at>clock_timestamp()
      and e.staging_verified_at is not null and e.status in ('canary_ready','canary_active','approved')
      and e.ui_version=3 and e.document_version=3
      and e.render_spec_version=4 and e.caption_render_spec_version=4
      and check_row.details->>'sourceGitSha'=e.git_sha
      and check_row.details->>'imageDigest'=e.worker_image_digest
      and check_row.details->>'fontManifestSha256'=e.font_manifest_sha256
    for share of e,check_row,u
  `;
  if (!r || !(community ? [COMMUNITY_TEMPLATE_RELEASE_ID] : [...SNS_GENERATION_RELEASE_IDS]).some(id => id === r.languageTestReleaseId)
    || !Array.isArray(r.details?.generationReleaseIds) || !r.details.generationReleaseIds.includes(r.languageTestReleaseId)) {
    throw new HttpError(409, "SNS 편집기를 준비 중입니다. 잠시 후 다시 열어 주세요.", "SNS_EDITOR_UNAVAILABLE");
  }
  return { languageTest: true, channel: "canary", releaseId: r.id, uiVersion: 3, documentVersion: 3,
    subtitleEditingCapable: false, subtitleEditingPublicEnabled: false, renderSpecVersion: 4,
    captionRenderSpecVersion: 4, fontManifestSha256: r.fontManifestSha256, renderV4Authorized: true };
}
