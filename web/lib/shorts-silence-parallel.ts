import type { Sql, TransactionSql } from "postgres";
import type { ProjectDispatchTarget } from "./job-dispatch";
import type { EditorReleaseAssignment } from "./editor-rendering-release";
import { HttpError } from "./http";
import { selectSilenceAdmissionTarget, type SilenceAdmission, type SilenceRolloutSnapshot } from "./shorts-silence-rollout";

/** Disabled on existing builds. This is a server-only exact pin, not a client
 * option. Registration and activation are separate verified operator actions. */
export async function parallelSilenceTarget(
  db: TransactionSql, request: SilenceAdmission,
  existing: ProjectDispatchTarget, canonical: ProjectDispatchTarget = existing,
) {
  const releaseId = process.env.SHORTS_SILENCE_PARALLEL_RELEASE_ID;
  if (!releaseId || !request.silenceRequested || request.sourceType !== "youtube") return null;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(releaseId)) return null;
  const [r] = await db`select q.enabled,q.percentage,u.is_admin,
      e.id,e.git_sha,e.worker_image_digest,e.font_manifest_sha256,
      r.proof::text as proof_json
    from shorts_mvp.shorts_silence_routing q
    join shorts_mvp.shorts_silence_routes r on r.release_id=q.release_id
    join shorts_mvp.editor_releases e on e.id=r.release_id
    join shorts_mvp.app_users u on u.id=${request.userId}
    join shorts_mvp.editor_release_state state on state.singleton
    where q.singleton and q.release_id=${releaseId} and q.enabled
      and e.staging_verified_at is not null and e.status in ('canary_ready','canary_active','approved','stable')
      and e.render_spec_version=4 and e.caption_render_spec_version=4
      and not state.render_v4_kill_switch
      and (state.render_v4_infra_lease_id is null or state.render_v4_infra_lease_expires_at<=clock_timestamp())
      and exists(select 1 from shorts_mvp.runtime_feature_flags where flag_key='editor_rendering_v2' and enabled)
      and exists(select 1 from shorts_mvp.runtime_feature_flags where flag_key='admin_shorts_silence' and enabled)
      and (u.is_admin or exists(select 1 from shorts_mvp.runtime_feature_flags where flag_key='public_shorts_silence' and enabled))
    for share of q,r,e,state,u`;
  if (!r) return null;
  let proof;
  try { proof = JSON.parse(r.proofJson); } catch { return null; }
  if (proof.sourceGitSha !== r.gitSha || proof.workerImageDigest !== r.workerImageDigest
    || proof.fontManifestSha256 !== r.fontManifestSha256) return null;
  const targets = await db`select target_key,batch_target_release_id,worker_source_git_sha,
      worker_image_digest,job_definition_arn,job_queue_arn
    from shorts_mvp.editor_release_project_targets where release_id=${releaseId} for share`;
  if (targets.some(t => {
    const p = proof.newTargets?.[t.targetKey];
    return !p || p.batchTargetReleaseId !== t.batchTargetReleaseId
      || p.workerSourceGitSha !== t.workerSourceGitSha || p.workerImageDigest !== t.workerImageDigest
      || p.jobDefinitionArn !== t.jobDefinitionArn || p.jobQueueArn !== t.jobQueueArn;
  })) return null;
  const snapshot: SilenceRolloutSnapshot = {
    enabled: r.enabled, releaseId, sourceGitSha: r.gitSha, imageDigest: r.workerImageDigest,
    fontManifestSha256: r.fontManifestSha256, percentage: r.isAdmin ? 100 : Number(r.percentage),
    languages: ["ko", "en", "ja"], templateKinds: ["standard", "custom", "sns", "community"],
    targets: targets.map(t => ({ targetKey: t.targetKey, releaseId: t.batchTargetReleaseId,
      workerSourceGitSha: t.workerSourceGitSha, workerImageDigest: t.workerImageDigest,
      jobDefinitionArn: t.jobDefinitionArn, jobQueueArn: t.jobQueueArn,
      v4Capability: { renderSpecVersion: 4, captionRenderSpecVersion: 4, fontManifestSha256: r.fontManifestSha256 } })),
  };
  const decision = selectSilenceAdmissionTarget(request, canonical, snapshot);
  return decision.mode === "inline" ? { releaseId: decision.editorReleaseId, target: decision.target } : null;
}

export async function parallelSilenceEditorRelease(db: Sql | TransactionSql, userId: string | null, shortId: string): Promise<EditorReleaseAssignment> {
  const [r] = await db`select e.id,e.ui_version,e.document_version,e.font_manifest_sha256,
      shorts_mvp.assert_shorts_silence_inline_job(j,false) as verified_binding
    from shorts_mvp.generated_shorts s join shorts_mvp.video_jobs j on j.id=s.job_id
    join shorts_mvp.shorts_silence_routes r on r.release_id=j.silence_inline_release_id
    join shorts_mvp.editor_releases e on e.id=r.release_id
    where s.id=${shortId} and s.user_id=${userId} and j.user_id=${userId}
      and s.deleted_at is null and j.user_deleted_at is null and s.expires_at>clock_timestamp()
    for share of r,e`;
  if (!r) throw new HttpError(409, "편집할 영상 정보를 다시 불러와 주세요.", "SILENCE_INLINE_EDITOR_UNAVAILABLE");
  return { silenceInline: true, unifiedTemplateEditingCapable: true, languageTest: true,
    channel: "canary", releaseId: r.id, uiVersion: r.uiVersion, documentVersion: r.documentVersion,
    subtitleEditingCapable: true, subtitleEditingPublicEnabled: true,
    renderSpecVersion: 4, captionRenderSpecVersion: 4, fontManifestSha256: r.fontManifestSha256,
    renderV4Authorized: true };
}
