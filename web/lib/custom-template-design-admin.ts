import "server-only";

import type { Sql, TransactionSql } from "postgres";
import { assertCustomTemplateDesignRenderRelease } from "@/lib/custom-template-design";
import { CUSTOM_TEMPLATE_DESIGN_ENABLED_FLAG, CUSTOM_TEMPLATE_DESIGN_PUBLIC_FLAG } from "@/lib/custom-template-design-access";
import { editorRenderingV2GlobalEnabled, editorRenderingV2MasterEnabled } from "@/lib/editor-rendering-release";
import { isEditorRenderSpecV4Enabled } from "@/lib/editor-render-v4-feature";
import { resolveFileUploadInitialRenderRelease } from "@/lib/initial-render-release";
import { allProjectDispatchTargets } from "@/lib/job-dispatch";
import {
  FILE_UPLOAD_EMERGENCY_STOP_FLAG_KEY,
  FILE_UPLOAD_FLAG_KEY,
  FILE_UPLOAD_PUBLIC_FLAG_KEY,
  fileUploadMasterEnabled,
} from "@/lib/file-upload-release";
import { HttpError } from "@/lib/http";

export type CustomTemplateDesignMode = "off" | "admin" | "public";
export type CustomTemplateDesignAdminState = {
  mode: CustomTemplateDesignMode;
  readyForAdmin: boolean;
  readyForPublic: boolean;
  readinessMessage?: string;
};

/** Only the web's exact deployed targets may expose a new renderer contract. */
export async function assertCustomTemplateDesignRuntimeReady(tx: TransactionSql, publicMode: boolean) {
  const unavailable = () => new HttpError(409,
    "현재 웹·영상 워커·파일 업로드 수신기의 배경·텍스트 검증과 연결 확인이 필요합니다.",
    "CUSTOM_TEMPLATE_DESIGN_RUNTIME_NOT_READY");
  if (!editorRenderingV2MasterEnabled() || !editorRenderingV2GlobalEnabled()
    || !isEditorRenderSpecV4Enabled() || !fileUploadMasterEnabled()) throw unavailable();
  // Match upload admission's lock order: upload mode before editor release state.
  const uploadFlags = await tx`
    select flag_key,enabled from shorts_mvp.runtime_feature_flags
    where flag_key in (${FILE_UPLOAD_FLAG_KEY},${FILE_UPLOAD_PUBLIC_FLAG_KEY},${FILE_UPLOAD_EMERGENCY_STOP_FLAG_KEY})
    order by flag_key for share
  `;
  const uploadMode = new Map(uploadFlags.map((row) => [String(row.flagKey), row.enabled === true]));
  if (uploadMode.size !== 3 || uploadMode.get(FILE_UPLOAD_FLAG_KEY) !== true
    || uploadMode.get(FILE_UPLOAD_EMERGENCY_STOP_FLAG_KEY) !== false
    || (publicMode && uploadMode.get(FILE_UPLOAD_PUBLIC_FLAG_KEY) !== true)) throw unavailable();
  const states = await tx`
    select s.stable_release_id,s.candidate_release_id,s.canary_enabled,s.public_enabled,
      s.render_v4_target_successor,
      s.render_v4_internal_enabled,s.render_v4_rollout_percent,s.render_v4_kill_switch,
      (s.render_v4_infra_lease_id is not null and s.render_v4_infra_lease_expires_at>clock_timestamp()) as lease_active,
      f.enabled as editor_enabled
    from shorts_mvp.editor_release_state s
    join shorts_mvp.runtime_feature_flags f on f.flag_key='editor_rendering_v2'
    where s.singleton for share of s,f
  `;
  const state = states[0];
  if (state?.editorEnabled !== true || state.renderV4KillSwitch !== false || state.leaseActive !== false) throw unavailable();
  const successor = state.renderV4TargetSuccessor;
  if (successor !== undefined && successor !== null
    && (successor.version !== 1 || !["admin_ready", "active"].includes(successor.phase))) throw unavailable();
  const readySuccessor = successor?.phase === "admin_ready"
    && successor.successorReleaseId === state.candidateReleaseId
    && successor.predecessorReleaseId === state.stableReleaseId;
  if (successor?.phase === "admin_ready" && (!readySuccessor || publicMode)) throw unavailable();
  if (successor?.phase === "active" && successor.activeReleaseId !== state.stableReleaseId) throw unavailable();
  const usesCanary = !publicMode && state.canaryEnabled === true
    && (state.renderV4InternalEnabled === true || readySuccessor);
  // Stable public v4 admission does not depend on the separate internal canary flag.
  if (!usesCanary && (state.publicEnabled !== true || state.renderV4RolloutPercent !== 100)) throw unavailable();
  const projectReleaseId = usesCanary
    ? String(state.candidateReleaseId || "") : String(state.stableReleaseId || "");
  await assertCustomTemplateDesignRenderRelease(tx, projectReleaseId);
  const registered = await tx`
    select target.target_key,target.batch_target_release_id,
      target.worker_source_git_sha,target.worker_image_digest,
      target.job_definition_arn,target.job_queue_arn,
      release.render_spec_version,release.caption_render_spec_version,release.font_manifest_sha256,
      release.git_sha as release_git_sha,release.worker_image_digest as release_worker_image_digest
    from shorts_mvp.editor_release_project_targets target
    join shorts_mvp.editor_releases release on release.id=target.release_id
    where target.release_id=${projectReleaseId} for share of target,release
  `;
  const targets = allProjectDispatchTargets();
  if (registered.length !== 5 || targets.length !== 5
    || new Set(targets.map((target) => target.targetKey)).size !== 5
    || targets.some((target) => !registered.some((row) => (
    row.targetKey === target.targetKey && row.batchTargetReleaseId === target.releaseId
    && row.workerSourceGitSha === target.workerSourceGitSha && row.workerImageDigest === target.workerImageDigest
    && row.releaseGitSha === target.workerSourceGitSha && row.releaseWorkerImageDigest === target.workerImageDigest
    && row.jobDefinitionArn === target.jobDefinitionArn && row.jobQueueArn === target.jobQueueArn
    && row.renderSpecVersion === 4 && row.captionRenderSpecVersion === 4
    && target.v4Capability?.renderSpecVersion === 4 && target.v4Capability.captionRenderSpecVersion === 4
    && row.fontManifestSha256 === target.v4Capability.fontManifestSha256
  )))) throw unavailable();
  const upload = await resolveFileUploadInitialRenderRelease(tx, {
    targetKey: "legacy_project",
    access: { adminEnabled: !publicMode, publicEnabled: uploadMode.get(FILE_UPLOAD_PUBLIC_FLAG_KEY) === true },
  });
  if (!upload) throw unavailable();
  await assertCustomTemplateDesignRenderRelease(tx, upload.releaseId);
  return { projectReleaseId, uploadReleaseId: upload.releaseId };
}

/**
 * Database evidence of administrator generation and successful re-edit on both
 * intake paths. Download availability and visual parity still need human review.
 */
export async function assertCustomTemplateDesignCanaryResults(
  tx: TransactionSql,
  releases: { projectReleaseId: string; uploadReleaseId: string },
) {
  const rows = await tx`
    select distinct j.source_type
    from shorts_mvp.video_jobs j
    join shorts_mvp.app_users u on u.id=j.user_id and u.is_admin and u.withdrawn_at is null
    join shorts_mvp.generated_shorts s on s.job_id=j.id and s.user_id=j.user_id
    join shorts_mvp.editor_render_requests r on r.short_id=s.id and r.user_id=j.user_id
    join shorts_mvp.editor_releases edit_release on edit_release.id=r.release_id
      and edit_release.worker_image_digest=r.worker_image_digest
    where j.status='completed' and j.user_deleted_at is null
      and j.source_type in ('youtube','upload')
      and j.initial_editor_release_id=case when j.source_type='upload'
        then ${releases.uploadReleaseId}::uuid else ${releases.projectReleaseId}::uuid end
      and j.template_snapshot#>>'{config,background,kind}'='uploaded_image'
      and jsonb_array_length(case when jsonb_typeof(j.template_snapshot#>'{config,textOverlays}')='array'
        then j.template_snapshot#>'{config,textOverlays}' else '[]'::jsonb end)>0
      and s.status='ready' and length(s.output_s3_key)>0 and s.deleted_at is null
      and (s.expires_at is null or s.expires_at>now()) and s.editor_document is not null
      and s.pending_edit_request_id is null
      and coalesce(s.editor_document#>>'{overlays,background,kind}',
        s.editor_document#>>'{template,snapshot,config,background,kind}')='uploaded_image'
      and exists (
        select 1 from jsonb_array_elements(case
          when jsonb_typeof(s.editor_document#>'{overlays,textOverlays}')='array'
          then s.editor_document#>'{overlays,textOverlays}' else '[]'::jsonb end) saved_text
        where saved_text->>'id' like 'tpl:' || (j.template_snapshot->>'id') || ':%'
      )
      and r.status='succeeded' and r.completed_at is not null and r.batch_job_id is not null
      and r.release_id=${releases.projectReleaseId}
      and r.output_render_version=s.render_version
  `;
  const sources = new Set(rows.map((row) => row.sourceType));
  if (!sources.has("youtube") || !sources.has("upload")) {
    throw new HttpError(409,
      "관리자 계정에서 내 배경과 텍스트가 있는 템플릿으로 YouTube·파일 업로드 생성과 재편집을 각각 완료해 주세요. 다운로드 영상과 미리보기도 확인한 뒤 공개해 주세요.",
      "CUSTOM_TEMPLATE_DESIGN_CANARY_REQUIRED");
  }
}

export async function getCustomTemplateDesignAdminState(db: Sql): Promise<CustomTemplateDesignAdminState> {
  const flags = await db`
    select flag_key,enabled from shorts_mvp.runtime_feature_flags
    where flag_key in (${CUSTOM_TEMPLATE_DESIGN_ENABLED_FLAG},${CUSTOM_TEMPLATE_DESIGN_PUBLIC_FLAG})
  `;
  const enabled = flags.some((row) => row.flagKey === CUSTOM_TEMPLATE_DESIGN_ENABLED_FLAG && row.enabled === true);
  const publicEnabled = flags.some((row) => row.flagKey === CUSTOM_TEMPLATE_DESIGN_PUBLIC_FLAG && row.enabled === true);
  const result: CustomTemplateDesignAdminState = {
    mode: !enabled ? "off" : publicEnabled ? "public" : "admin", readyForAdmin: false, readyForPublic: false,
  };
  if (flags.length !== 2) return { ...result, mode: "off", readinessMessage: "배경 보관과 공개 제어 준비가 아직 반영되지 않았습니다." };
  try {
    await db.begin(async (tx) => { await assertCustomTemplateDesignRuntimeReady(tx, false); });
    result.readyForAdmin = true;
    await db.begin(async (tx) => {
      const releases = await assertCustomTemplateDesignRuntimeReady(tx, true);
      await assertCustomTemplateDesignCanaryResults(tx, releases);
    });
    result.readyForPublic = true;
  } catch (error) {
    result.readinessMessage = error instanceof HttpError ? error.message : "배포된 영상 처리 구성의 검증과 연결 확인이 필요합니다.";
  }
  return result;
}
