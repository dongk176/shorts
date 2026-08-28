import type { TransactionSql } from "postgres";
import { isEditorRenderSpecV4Enabled } from "@/lib/editor-render-v4-feature";
import type { ProjectDispatchTarget } from "@/lib/job-dispatch";

export type InitialRenderRelease = {
  releaseId: string;
  renderSpecVersion: 4;
  captionRenderSpecVersion: 4;
  fontManifestSha256: string;
  workerImageDigest: string;
};

type FileUploadReleaseAccess = {
  adminEnabled: boolean;
  publicEnabled: boolean;
};

const GIT_SHA = /^[0-9a-f]{40}$/;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;
const FONT_MANIFEST_SHA256 = /^[0-9a-f]{64}$/;

function fileUploadWorkerIdentity() {
  const workerSourceGitSha =
    process.env.FILE_UPLOAD_WORKER_SOURCE_GIT_SHA?.trim() || "";
  const workerImageDigest =
    process.env.FILE_UPLOAD_WORKER_IMAGE_DIGEST?.trim() || "";
  const fontManifestSha256 =
    process.env.FILE_UPLOAD_WORKER_FONT_MANIFEST_SHA256?.trim() || "";
  if (
    !GIT_SHA.test(workerSourceGitSha)
    || !IMAGE_DIGEST.test(workerImageDigest)
    || !FONT_MANIFEST_SHA256.test(fontManifestSha256)
  ) {
    return null;
  }
  return { workerSourceGitSha, workerImageDigest, fontManifestSha256 };
}

export async function resolveInitialRenderRelease(
  tx: TransactionSql,
  input: {
    userId: string | null;
    dispatchTarget: ProjectDispatchTarget | null;
  },
): Promise<InitialRenderRelease | null> {
  const target = input.dispatchTarget;
  if (
    !input.userId
    || !target?.v4Capability
    || !isEditorRenderSpecV4Enabled()
  ) {
    return null;
  }

  const rows = await tx`
    select release_id,render_spec_version,caption_render_spec_version,
      font_manifest_sha256,release_worker_image_digest
    from shorts_mvp.resolve_initial_render_v4_release(
      ${input.userId},
      ${target.targetKey},
      ${target.releaseId},
      ${target.jobDefinitionArn},
      ${target.jobQueueArn},
      ${target.workerImageDigest},
      ${target.workerSourceGitSha}
    )
  `;
  const release = rows.length === 1 ? rows[0] : null;
  if (
    !release
    || release.renderSpecVersion !== 4
    || release.captionRenderSpecVersion !== 4
    || release.fontManifestSha256
      !== target.v4Capability.fontManifestSha256
    || release.releaseWorkerImageDigest !== target.workerImageDigest
    || typeof release.releaseId !== "string"
  ) {
    return null;
  }
  return {
    releaseId: release.releaseId,
    renderSpecVersion: 4,
    captionRenderSpecVersion: 4,
    fontManifestSha256: release.fontManifestSha256,
    workerImageDigest: release.releaseWorkerImageDigest,
  };
}

/**
 * Bind an upload job to the exact immutable worker that receives its source.
 *
 * The upload service is intentionally independent from the Batch target
 * currently used by ordinary link jobs. During administrator testing it may
 * use the verified candidate without changing the stable link dispatch
 * environment. Public uploads fail closed until that same worker has become
 * the stable release. The upload mode and editor state rows remain locked
 * until the caller atomically inserts the job and usage reservation.
 */
export async function resolveFileUploadInitialRenderRelease(
  tx: TransactionSql,
  input: {
    targetKey: ProjectDispatchTarget["targetKey"];
    access: FileUploadReleaseAccess;
  },
): Promise<InitialRenderRelease | null> {
  const identity = fileUploadWorkerIdentity();
  const channel = input.access.publicEnabled
    ? "stable"
    : input.access.adminEnabled
      ? "candidate"
      : null;
  if (!identity || !channel || !isEditorRenderSpecV4Enabled()) return null;

  const rows = await tx`
    select release.id as release_id,
      release.render_spec_version,
      release.caption_render_spec_version,
      release.font_manifest_sha256,
      release.worker_image_digest as release_worker_image_digest
    from shorts_mvp.editor_release_state state
    join shorts_mvp.runtime_feature_flags runtime
      on runtime.flag_key='editor_rendering_v2'
    join shorts_mvp.editor_releases release
      on release.id=case
        when ${channel}='candidate' then state.candidate_release_id
        else state.stable_release_id
      end
    join shorts_mvp.editor_release_project_targets project_target
      on project_target.release_id=release.id
      and project_target.target_key=${input.targetKey}
    where state.singleton
      and runtime.enabled
      and not state.render_v4_kill_switch
      and not (
        state.render_v4_infra_lease_id is not null
        and state.render_v4_infra_lease_expires_at>clock_timestamp()
      )
      and release.render_spec_version=4
      and release.caption_render_spec_version=4
      and release.git_sha=${identity.workerSourceGitSha}
      and release.worker_image_digest=${identity.workerImageDigest}
      and release.font_manifest_sha256=${identity.fontManifestSha256}
      and project_target.worker_source_git_sha=${identity.workerSourceGitSha}
      and project_target.worker_image_digest=${identity.workerImageDigest}
      and (
        (
          ${channel}='candidate'
          and release.status in ('canary_ready','canary_active','approved')
          and release.staging_verified_at is not null
        ) or (
          ${channel}='stable'
          and state.public_enabled
          and release.status='stable'
          and release.promoted_at is not null
        )
      )
    for share of state,runtime,release,project_target
  `;
  const release = rows.length === 1 ? rows[0] : null;
  if (
    !release
    || release.renderSpecVersion !== 4
    || release.captionRenderSpecVersion !== 4
    || release.fontManifestSha256 !== identity.fontManifestSha256
    || release.releaseWorkerImageDigest !== identity.workerImageDigest
    || typeof release.releaseId !== "string"
  ) {
    return null;
  }
  return {
    releaseId: release.releaseId,
    renderSpecVersion: 4,
    captionRenderSpecVersion: 4,
    fontManifestSha256: release.fontManifestSha256,
    workerImageDigest: release.releaseWorkerImageDigest,
  };
}
