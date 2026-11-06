import type { Sql, TransactionSql } from "postgres";
import type { ProjectDispatchTarget } from "./job-dispatch";
import type { EditorReleaseAssignment } from "./editor-rendering-release";
import { HttpError } from "./http";

const queue = "arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-editor-test";
function unavailable() {
  return new HttpError(503, "관리자 테스트 서버를 준비하고 있습니다.", "SILENCE_TEST_UNAVAILABLE");
}

/** Candidate-only server setting. Ordinary members always retain their current route. */
export async function silenceTestTarget(db: TransactionSql, userId: string | null, base: ProjectDispatchTarget) {
  const id = process.env.ADMIN_SILENCE_TEST_RELEASE_ID;
  if (!id) return null;
  const [user] = await db`select is_admin from shorts_mvp.app_users where id=${userId} for share`;
  if (user?.isAdmin !== true) return null;
  if (!/^[a-f0-9-]{36}$/.test(id)) throw unavailable();
  const [r] = await db`select q.id,q.job_queue_arn,e.git_sha,e.worker_image_digest,e.font_manifest_sha256,
      t.target_key,t.batch_target_release_id,t.job_definition_arn
    from shorts_mvp.silence_test_releases q
    join shorts_mvp.editor_releases e on e.id=q.id
    join shorts_mvp.editor_release_project_targets t on t.release_id=e.id and t.target_key=${base.targetKey}
    join shorts_mvp.editor_release_state s on s.singleton
    where q.id=${id} and q.administrator_id=${userId} and q.enabled
      and q.verified_at is not null and q.expires_at>clock_timestamp() and q.admitted_jobs<q.max_jobs
      and e.staging_verified_at is not null and e.status in ('canary_ready','canary_active','approved')
      and e.render_spec_version=4 and e.caption_render_spec_version=4
      and t.worker_source_git_sha=e.git_sha and t.worker_image_digest=e.worker_image_digest
      and not s.render_v4_kill_switch
      and (s.render_v4_infra_lease_id is null or s.render_v4_infra_lease_expires_at<=clock_timestamp())
    for share of q,e,t,s`;
  if (!r || r.jobQueueArn !== queue
    || !/^[a-f0-9]{40}$/.test(r.gitSha) || !/^sha256:[a-f0-9]{64}$/.test(r.workerImageDigest)
    || !/^[a-f0-9]{64}$/.test(r.fontManifestSha256)
    || !/^arn:aws:batch:ap-northeast-2:181651591905:job-definition\/shorts-mvp-editor-v4-[a-z0-9-]+:[1-9][0-9]*$/.test(r.jobDefinitionArn)) throw unavailable();
  const target: ProjectDispatchTarget = {
    targetKey: base.targetKey, releaseId: r.batchTargetReleaseId,
    workerSourceGitSha: r.gitSha, workerImageDigest: r.workerImageDigest,
    jobDefinitionArn: r.jobDefinitionArn, jobQueueArn: queue,
    v4Capability: { renderSpecVersion: 4, captionRenderSpecVersion: 4, fontManifestSha256: r.fontManifestSha256 },
  };
  return { releaseId: r.id as string, target };
}

/** Existing QA output remains pinned after the bounded creation window expires. */
export async function silenceTestEditorRelease(db: Sql | TransactionSql, userId: string | null, shortId: string): Promise<EditorReleaseAssignment> {
  const [r] = await db`select e.id,e.ui_version,e.document_version,e.font_manifest_sha256,
      e.git_sha,e.worker_image_digest,q.verification::text as verification_json,
      case when j.template_snapshot->>'communityTemplateVersion'='1' then 'community'
        when j.template_snapshot->>'snsTemplateVersion'='1' then 'sns'
        when j.custom_template_id is not null then 'custom' else 'standard' end as template_kind
    from shorts_mvp.generated_shorts s join shorts_mvp.video_jobs j on j.id=s.job_id
    join shorts_mvp.app_users u on u.id=j.user_id and u.is_admin
    join shorts_mvp.silence_test_releases q on q.id=j.silence_test_release_id and q.administrator_id=u.id
    join shorts_mvp.editor_releases e on e.id=q.id
    where s.id=${shortId} and s.user_id=${userId} and j.user_id=${userId}
      and s.deleted_at is null and j.user_deleted_at is null and s.expires_at>clock_timestamp()
      and q.verified_at is not null and e.staging_verified_at is not null
      and e.status in ('canary_ready','canary_active','approved')
      and e.render_spec_version=4 and e.caption_render_spec_version=4
    for share of q,e,u`;
  if (!r) throw unavailable();
  let scope;
  try { scope = JSON.parse(r.verificationJson ?? "{}").authorizedTestScope; } catch { scope = null; }
  const unified = scope?.version === 1 && scope.sourceGitSha === r.gitSha
    && scope.workerImageDigest === r.workerImageDigest
    && Array.isArray(scope.templateKinds) && scope.templateKinds.includes(r.templateKind)
    && ["custom", "sns", "community"].includes(r.templateKind);
  return { silenceTest: true, unifiedTemplateEditingCapable: unified, languageTest: true, channel: "canary", releaseId: r.id, uiVersion: r.uiVersion,
    documentVersion: r.documentVersion, subtitleEditingCapable: true,
    subtitleEditingPublicEnabled: true, renderSpecVersion: 4, captionRenderSpecVersion: 4,
    fontManifestSha256: r.fontManifestSha256, renderV4Authorized: true };
}
