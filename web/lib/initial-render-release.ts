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
