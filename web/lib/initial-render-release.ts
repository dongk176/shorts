import type { TransactionSql } from "postgres";
import { isEditorRenderSpecV4Enabled } from "@/lib/editor-render-v4-feature";
import { HttpError } from "@/lib/http";
import type { ProjectDispatchTarget } from "@/lib/job-dispatch";
import { assertCustomTemplateDesignRenderRelease } from "@/lib/custom-template-design";
import { verifiedFileUploadSuccessorAdminReleaseId } from "@/lib/file-upload-successor";

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

const FILE_UPLOAD_RELEASE_CHECK_KEYS = new Set([
  "admin_end_to_end",
  "render_parity",
  "upload_1gb",
  "upload_5gb",
  "source_cleanup",
  "usage_integrity",
  "runtime_identity",
  "no_proxy_environment",
  "no_stuck_sessions",
]);

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

function verifiedPublicUploadReleaseId(
  rows: Array<{ checkKey?: unknown; passed?: unknown; details?: unknown }>,
  identity: ReturnType<typeof fileUploadWorkerIdentity>,
) {
  if (!identity || rows.length !== FILE_UPLOAD_RELEASE_CHECK_KEYS.size
    || !GIT_SHA.test(identity.workerSourceGitSha)
    || !IMAGE_DIGEST.test(identity.workerImageDigest)
    || !FONT_MANIFEST_SHA256.test(identity.fontManifestSha256)) return null;
  const checks = new Map(rows.map((row) => [String(row.checkKey || ""), row]));
  if (
    checks.size !== FILE_UPLOAD_RELEASE_CHECK_KEYS.size
    || [...FILE_UPLOAD_RELEASE_CHECK_KEYS].some((key) => checks.get(key)?.passed !== true)
  ) {
    return null;
  }
  const runtime = checks.get("runtime_identity")?.details;
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) return null;
  const details = runtime as Record<string, unknown>;
  const releaseId = String(details.releaseId || "");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(releaseId)
    || details.sourceGitSha !== identity.workerSourceGitSha
    || details.workerImageDigest !== identity.workerImageDigest
    || details.fontManifestSha256 !== identity.fontManifestSha256
    || details.renderSpecVersion !== 4
    || details.captionRenderSpecVersion !== 4
  ) {
    return null;
  }
  for (const row of checks.values()) {
    if (!row.details || typeof row.details !== "object" || Array.isArray(row.details)) {
      return null;
    }
    if ((row.details as Record<string, unknown>).sourceGitSha !== identity.workerSourceGitSha) {
      return null;
    }
  }
  const renderParity = checks.get("render_parity")?.details as
    | Record<string, unknown>
    | undefined;
  const adminEndToEnd = checks.get("admin_end_to_end")?.details as
    | Record<string, unknown>
    | undefined;
  if (
    renderParity?.releaseId !== releaseId
    || adminEndToEnd?.releaseId !== releaseId
  ) {
    return null;
  }
  return releaseId;
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
    // Preserve deliberate legacy/percentage rollout behavior, but never turn a
    // deployment handoff or exact-target mismatch into a legacy job and charge.
    const gates = await tx`
      select (
        (state.render_v4_target_successor is not null and (
          state.render_v4_target_successor->>'phase'<>'active'
          or state.render_v4_target_successor->'activeRegistry'->'lanes'
            ->${target.targetKey}->'current'->>'releaseId' is distinct from ${target.releaseId}
          or state.render_v4_target_successor->'activeRegistry'->'lanes'
            ->${target.targetKey}->'current'->>'jobDefinitionArn' is distinct from ${target.jobDefinitionArn}
          or state.render_v4_target_successor->'activeRegistry'->'lanes'
            ->${target.targetKey}->'current'->>'jobQueueArn' is distinct from ${target.jobQueueArn}
        ))
        or
        (state.render_v4_infra_lease_id is not null
          and state.render_v4_infra_lease_expires_at>clock_timestamp())
        or (runtime.enabled and not state.render_v4_kill_switch and (
          (state.public_enabled and stable.render_spec_version=4
            and state.render_v4_rollout_percent>(
              ('x'||substr(md5(${input.userId}::text||':editor-render-v4'),1,8))::bit(32)::bigint%100
            ))
          or (state.canary_enabled and state.render_v4_internal_enabled
            and candidate.render_spec_version=4 and exists(
              select 1 from shorts_mvp.editor_release_testers t
              where t.user_id=${input.userId} and t.enabled
            ))
        ))
      ) as v4_required
      from shorts_mvp.editor_release_state state
      join shorts_mvp.runtime_feature_flags runtime on runtime.flag_key='editor_rendering_v2'
      left join shorts_mvp.editor_releases stable on stable.id=state.stable_release_id
      left join shorts_mvp.editor_releases candidate on candidate.id=state.candidate_release_id
      where state.singleton for share of state,runtime
    `;
    if (gates.length !== 1 || gates[0].v4Required !== false) {
      throw new HttpError(503,
        "영상 처리 버전의 연결을 확인 중입니다. 잠시 후 다시 시도해 주세요. 사용량은 차감되지 않았습니다.",
        "INITIAL_RENDER_RELEASE_HANDOFF", 2);
    }
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
 * currently used by ordinary link jobs. Both administrator testing and public
 * uploads use the exact immutable release deployed to the upload receiver.
 * Public uploads additionally require the auditable release checks to pin the
 * same release identity. The upload mode, checks, and editor state rows remain
 * locked until the caller atomically inserts the job and usage reservation.
 */
export async function resolveFileUploadInitialRenderRelease(
  tx: TransactionSql,
  input: {
    targetKey: ProjectDispatchTarget["targetKey"];
    access: FileUploadReleaseAccess;
  },
): Promise<InitialRenderRelease | null> {
  const identity = fileUploadWorkerIdentity();
  if (
    !identity
    || (!input.access.adminEnabled && !input.access.publicEnabled)
    || !isEditorRenderSpecV4Enabled()
  ) {
    return null;
  }

  // Read the separate successor column even in admin-only mode. An in-progress
  // handoff must stay fenced when a public flag is changed or evidence expires.
  const checkRows = await tx`
    select check_key,passed,details,successor
    from shorts_mvp.file_upload_release_checks
    where check_key in (
      'admin_end_to_end','render_parity','upload_1gb','upload_5gb',
      'source_cleanup','usage_integrity','runtime_identity',
      'no_proxy_environment','no_stuck_sessions'
    )
    order by check_key
    for share
  `;
  const runtimeRow = checkRows.find((row) => row.checkKey === "runtime_identity");
  const hasSuccessor = runtimeRow?.successor !== null && runtimeRow?.successor !== undefined;
  let pinnedReleaseId: string | null = null;
  if (hasSuccessor) {
    if (!runtimeRow) return null;
    // The old nine checks remain pinned until atomic promotion. They must not
    // be failed or drift while the separately attested successor is tested.
    const previous = runtimeRow?.details;
    if (!previous || typeof previous !== "object" || Array.isArray(previous)
      || !verifiedPublicUploadReleaseId(checkRows, {
        workerSourceGitSha: String(previous.sourceGitSha || ""),
        workerImageDigest: String(previous.workerImageDigest || ""),
        fontManifestSha256: String(previous.fontManifestSha256 || ""),
      })) return null;
    pinnedReleaseId = verifiedFileUploadSuccessorAdminReleaseId(
      runtimeRow, identity, input.access.adminEnabled,
    );
    if (!pinnedReleaseId) return null;
  } else if (input.access.publicEnabled) {
    // The 24-hour freshness window is enforced atomically when public mode is
    // enabled. Per-session admission keeps checking explicit pass/fail state
    // and exact pinned identity so public access cannot silently drift, while
    // avoiding an automatic outage solely because wall-clock time elapsed.
    pinnedReleaseId = verifiedPublicUploadReleaseId(checkRows, identity);
    if (!pinnedReleaseId) return null;
  }

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
      on release.git_sha=${identity.workerSourceGitSha}
      and release.worker_image_digest=${identity.workerImageDigest}
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
      and (${pinnedReleaseId}::uuid is null or release.id=${pinnedReleaseId}::uuid)
      and release.git_sha=${identity.workerSourceGitSha}
      and release.worker_image_digest=${identity.workerImageDigest}
      and release.font_manifest_sha256=${identity.fontManifestSha256}
      and project_target.worker_source_git_sha=${identity.workerSourceGitSha}
      and project_target.worker_image_digest=${identity.workerImageDigest}
      and release.status in (
        'staging_verified','canary_ready','canary_active','approved','stable'
      )
      and release.staging_verified_at is not null
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
  if (hasSuccessor) {
    await assertCustomTemplateDesignRenderRelease(tx, release.releaseId);
  }
  return {
    releaseId: release.releaseId,
    renderSpecVersion: 4,
    captionRenderSpecVersion: 4,
    fontManifestSha256: release.fontManifestSha256,
    workerImageDigest: release.releaseWorkerImageDigest,
  };
}
