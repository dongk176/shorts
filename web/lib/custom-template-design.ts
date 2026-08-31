import type { TransactionSql } from "postgres";
import { collectBackgroundAssetIds } from "@/lib/background-assets-contract";
import { lockOwnedBackgroundAssets } from "@/lib/background-assets";
import {
  assertCustomTemplateDesignAccess,
  lockCustomTemplateDesignAccess,
} from "@/lib/custom-template-design-access";
import { HttpError } from "@/lib/http";
import { type TemplateConfig } from "@/lib/template-config";
import { templateDesignFingerprint, templateHasCustomDesign } from "@/lib/template-design";

export const CUSTOM_TEMPLATE_DESIGN_ISOLATED_CHECKS = [
  "worker-image", "legacy-no-timeline", "captured-timeline", "editor-v2", "ffprobe", "frame-parity",
  "runtime-identity", "render-spec-v4", "caption-render-spec-v4", "worker-title-compositor-parity",
  "worker-caption-noop-parity", "font-manifest", "font-fallback", "browser-parity-worker-matrix",
  "browser-worker-visual-parity",
] as const;

export async function lockTemplateDesignForSave(
  tx: TransactionSql,
  userId: string | null,
  config: TemplateConfig,
  previous?: TemplateConfig,
) {
  if (templateHasCustomDesign(config)
    && (!previous || templateDesignFingerprint(config) !== templateDesignFingerprint(previous))) {
    assertCustomTemplateDesignAccess(await lockCustomTemplateDesignAccess(tx, userId));
  }
  const ids = collectBackgroundAssetIds(config);
  if (ids.length) {
    if (!userId) throw new HttpError(401, "로그인이 필요합니다.");
    await lockOwnedBackgroundAssets(tx, userId, ids);
  }
}

/** No new format is dispatched to a merely-v4, but design-unaware, renderer. */
export async function assertCustomTemplateDesignRenderRelease(
  tx: TransactionSql,
  releaseId: string | null | undefined,
) {
  const unavailable = () => new HttpError(
    503,
    "배경·템플릿 텍스트 렌더를 준비 중입니다. 잠시 후 다시 시도해 주세요. 사용량은 차감되지 않았습니다.",
    "CUSTOM_TEMPLATE_DESIGN_RENDER_UNAVAILABLE",
  );
  if (!releaseId) throw unavailable();
  const rows = await tx`
    select r.git_sha,r.worker_image_digest,r.font_manifest_sha256,
      r.render_spec_version,r.caption_render_spec_version,
      p.id as probe_run_id,p.git_sha as probe_git_sha,
      p.worker_image_digest as probe_worker_image_digest,
      p.font_manifest_sha256 as probe_font_manifest_sha256,
      p.artifact_uri,p.manifest_sha256,p.manifest_s3_version_id,
      p.matrix_sha256,p.matrix_s3_version_id,
      c.details,c.artifact_uri as check_artifact_uri
    from shorts_mvp.editor_releases r
    join shorts_mvp.editor_release_probe_runs p
      on p.finalized_release_id=r.id and p.state='finalized'
    join shorts_mvp.editor_release_checks c
      on c.release_id=r.id and c.environment='isolated'
      and c.check_name='render-spec-v4' and c.status='passed'
    where r.id=${releaseId}
    for share of r,p,c
  `;
  const row = rows.length === 1 ? rows[0] : null;
  const evidence = row?.details?.customTemplateDesign;
  if (!row || !evidence
    || evidence.version !== 1 || evidence.passed !== true
    || evidence.wrapRevision !== "editor-text-v1"
    || evidence.renderSpecVersion !== 4 || evidence.captionRenderSpecVersion !== 4
    || row.renderSpecVersion !== 4 || row.captionRenderSpecVersion !== 4
    || evidence.sourceGitSha !== row.gitSha || row.probeGitSha !== row.gitSha
    || evidence.workerImageDigest !== row.workerImageDigest
    || row.probeWorkerImageDigest !== row.workerImageDigest
    || evidence.fontManifestSha256 !== row.fontManifestSha256
    || row.probeFontManifestSha256 !== row.fontManifestSha256
    || row.details.probeRunId !== row.probeRunId
    || row.checkArtifactUri !== row.artifactUri
    || !/^[0-9a-f]{64}$/.test(String(row.manifestSha256))
    || !/^[0-9a-f]{64}$/.test(String(row.matrixSha256))
    || !row.manifestS3VersionId || !row.matrixS3VersionId) {
    throw unavailable();
  }
  const checks = await tx`
    select check_name,status from shorts_mvp.editor_release_checks
    where release_id=${releaseId} and environment='isolated'
      and check_name=any(${[...CUSTOM_TEMPLATE_DESIGN_ISOLATED_CHECKS]})
    order by check_name for share
  `;
  const passed = new Set(checks.filter((check) => check.status === "passed").map((check) => check.checkName));
  if (passed.size !== CUSTOM_TEMPLATE_DESIGN_ISOLATED_CHECKS.length
    || CUSTOM_TEMPLATE_DESIGN_ISOLATED_CHECKS.some((check) => !passed.has(check))) throw unavailable();
  return { compatibleSuccessor: row.details.compatibleSuccessor as unknown };
}
