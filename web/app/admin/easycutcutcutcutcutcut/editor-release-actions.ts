"use server";

import { revalidatePath } from "next/cache";
import type { JSONValue, TransactionSql } from "postgres";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import {
  EDITOR_SUBTITLE_EDITING_PUBLIC_FLAG_KEY,
  EDITOR_RENDERING_V2_FLAG_KEY,
  editorRenderingV2GlobalEnabled,
  editorRenderingV2MasterEnabled,
} from "@/lib/editor-rendering-release";
import {
  canEnableEditorRenderV4Internal,
  editorRenderV4AuditEntityId,
  editorRenderV4ControlAuditActions,
  editorRenderV4EmergencyStoppedAction,
  editorRenderV4StoppedForNewCandidateAction,
  editorRenderV4StoppedOnPromotionAction,
  isEditorRenderV4EmergencyForRelease,
  nextEditorRenderV4RolloutPercent,
} from "@/lib/editor-render-v4-rollout-control";
import { isEditorRenderSpecV4Enabled } from "@/lib/editor-render-v4-feature";
import { allProjectDispatchTargets } from "@/lib/job-dispatch";
import {
  ELEVENLABS_PUBLIC_COMPLIANCE_APPROVED_FLAG_KEY,
  ELEVENLABS_TRANSCRIPTION_FLAG_KEY,
  ELEVENLABS_TRANSCRIPTION_PUBLIC_FLAG_KEY,
} from "@/lib/transcription-release";
import {
  SUBTITLE_TEMPLATES_FLAG_KEY,
  SUBTITLE_TEMPLATES_PUBLIC_FLAG_KEY,
  UNIFIED_TEMPLATE_SUBTITLES_CANARY_FLAG_KEY,
  UNIFIED_TEMPLATE_SUBTITLES_PUBLIC_FLAG_KEY,
} from "@/lib/subtitle-template-release";

const adminPath = "/admin/easycutcutcutcutcutcut?tab=editor-releases";
const uuidSchema = z.string().uuid();
const emailSchema = z.string().trim().toLowerCase().email().max(254);

const isolatedChecks = [
  "worker-image",
  "legacy-no-timeline",
  "captured-timeline",
  "editor-v2",
  "ffprobe",
  "frame-parity",
] as const;
const v4IsolatedChecks = [
  ...isolatedChecks,
  "browser-worker-visual-parity",
] as const;
const productionCanaryChecks = [
  "save-render-download",
  "gemini-comments",
  "reopen-reedit",
  "rollback-drill",
  "initial-project-admission",
] as const;
const productionCanaryCheckSchema = z.enum(productionCanaryChecks);
const renderV4PublicRolloutSchema = z.union([
  z.literal(5),
  z.literal(25),
  z.literal(100),
]);

async function recordAudit(
  tx: TransactionSql,
  actorUserId: string,
  action: string,
  entityId: string,
  metadata: JSONValue,
) {
  const isRenderV4Transition = (
    editorRenderV4ControlAuditActions as readonly string[]
  ).includes(action);
  const transitionSequence = isRenderV4Transition
    ? (await tx`
        select nextval(
          'shorts_mvp.editor_render_v4_audit_event_sequence'
        )::bigint as event_sequence
      `)[0]?.eventSequence ?? null
    : null;
  await tx`
    insert into shorts_mvp.admin_audit_logs (
      actor_user_id,action,entity_type,entity_id,metadata,created_at,
      render_v4_event_sequence
    ) values (
      ${actorUserId},${action},'editor_release',${entityId},
      ${tx.json(metadata)},clock_timestamp(),${transitionSequence}
    )
  `;
}

async function assertEditorRenderV4InfrastructureLeaseInactive(
  tx: TransactionSql,
) {
  const rows = await tx`
    select render_v4_infra_lease_id,render_v4_infra_lease_owner,
      render_v4_infra_lease_expires_at,
      (render_v4_infra_lease_id is not null
        and render_v4_infra_lease_expires_at > clock_timestamp()) as lease_active
    from shorts_mvp.editor_release_state
    where singleton=true
    for update
  `;
  if (rows[0]?.leaseActive === true) {
    throw new HttpError(
      409,
      "Stage B 인프라 변경이 진행 중입니다. 임대가 종료된 뒤 상태를 새로 확인해 주세요.",
      "EDITOR_RENDER_V4_INFRA_LEASE_ACTIVE",
    );
  }
}

async function assertChecksPassed(
  tx: TransactionSql,
  releaseId: string,
  environment: "isolated" | "production_canary",
  requiredChecks: readonly string[],
) {
  const rows = await tx`
    select check_name,status
    from shorts_mvp.editor_release_checks
    where release_id=${releaseId} and environment=${environment}
      and check_name=any(${requiredChecks as string[]})
  `;
  const passed = new Set(
    rows
      .filter((row) => row.status === "passed")
      .map((row) => String(row.checkName)),
  );
  const missing = requiredChecks.filter((name) => !passed.has(name));
  if (missing.length > 0) {
    throw new HttpError(
      409,
      `필수 검사가 완료되지 않았습니다: ${missing.join(", ")}`,
      "EDITOR_RELEASE_CHECKS_INCOMPLETE",
    );
  }
}

async function assertCanaryRenderEvidence(
  tx: TransactionSql,
  releaseId: string,
) {
  const requestCounts = await tx`
    select
      count(*) filter (
        where status in ('queued','rendering')
      )::integer as active,
      count(*) filter (where status='failed')::integer as failed,
      count(*) filter (where status='succeeded')::integer as succeeded
    from shorts_mvp.editor_render_requests
    where release_id=${releaseId}
  `;
  if (Number(requestCounts[0]?.active || 0) > 0) {
    throw new HttpError(409, "카나리 렌더링이 끝난 뒤 진행해 주세요.");
  }
  if (Number(requestCounts[0]?.failed || 0) > 0) {
    throw new HttpError(409, "실패한 카나리 렌더링이 있어 진행할 수 없습니다.");
  }
  if (Number(requestCounts[0]?.succeeded || 0) === 0) {
    throw new HttpError(
      409,
      "성공한 운영 카나리 렌더링이 한 건 이상 필요합니다.",
    );
  }
}

function assertExactRenderV4Capability(release: {
  renderSpecVersion?: number | null;
  captionRenderSpecVersion?: number | null;
  fontManifestSha256?: string | null;
}) {
  if (
    Number(release.renderSpecVersion) !== 4
    || Number(release.captionRenderSpecVersion) !== 4
    || !/^[0-9a-f]{64}$/.test(String(release.fontManifestSha256 || ""))
  ) {
    throw new HttpError(
      409,
      "정확한 v4 렌더·자막·폰트 검증 릴리스만 이 작업을 수행할 수 있습니다.",
      "EDITOR_RENDER_V4_CAPABILITY_REQUIRED",
    );
  }
}

async function assertRenderV4CanaryEvidence(
  tx: TransactionSql,
  releaseId: string,
) {
  await assertRenderV4ProjectTargetsRegistered(tx, releaseId);
  await assertChecksPassed(tx, releaseId, "isolated", v4IsolatedChecks);
  await assertChecksPassed(
    tx,
    releaseId,
    "production_canary",
    productionCanaryChecks,
  );
  await assertCanaryRenderEvidence(tx, releaseId);
}

function assertRenderV4EnvironmentEnabled() {
  if (!isEditorRenderSpecV4Enabled()) {
    throw new HttpError(
      409,
      "현재 웹 배포가 v4 렌더 명세를 지원하지 않아 활성화할 수 없습니다.",
      "EDITOR_RENDER_V4_WEB_RELEASE_DISABLED",
    );
  }
}

function assertRenderV4ProjectTargetEnvironment(release: {
  renderSpecVersion?: number | null;
  captionRenderSpecVersion?: number | null;
  fontManifestSha256?: string | null;
}) {
  let targets: ReturnType<typeof allProjectDispatchTargets>;
  try {
    targets = allProjectDispatchTargets();
  } catch {
    throw new HttpError(
      409,
      "현재 웹 배포의 프로젝트 워커 연결 정보가 완전하지 않아 v4를 활성화할 수 없습니다.",
      "EDITOR_RENDER_V4_PROJECT_TARGET_ENV_REQUIRED",
    );
  }
  const expectedFontManifest = String(release.fontManifestSha256 || "");
  const invalidTargets = targets.filter((target) => (
    target.v4Capability?.renderSpecVersion !== Number(release.renderSpecVersion)
    || target.v4Capability?.captionRenderSpecVersion
      !== Number(release.captionRenderSpecVersion)
    || target.v4Capability?.fontManifestSha256 !== expectedFontManifest
  ));
  if (invalidTargets.length > 0) {
    throw new HttpError(
      409,
      `v4 연결 정보가 누락되거나 다른 프로젝트 경로가 있습니다: ${invalidTargets.map((target) => target.targetKey).join(", ")}`,
      "EDITOR_RENDER_V4_PROJECT_TARGET_CAPABILITY_MISMATCH",
    );
  }
}

async function assertRenderV4ProjectTargetsRegistered(
  tx: TransactionSql,
  releaseId: string,
) {
  const rows = await tx`
    select count(target.target_key)::integer as target_count,
      coalesce(bool_and(
        target.worker_source_git_sha=release.git_sha
        and target.worker_image_digest=release.worker_image_digest
      ),false) as identities_match
    from shorts_mvp.editor_releases release
    left join shorts_mvp.editor_release_project_targets target
      on target.release_id=release.id
    where release.id=${releaseId}
    group by release.id
  `;
  if (
    Number(rows[0]?.targetCount || 0) !== 5
    || rows[0]?.identitiesMatch !== true
  ) {
    throw new HttpError(
      409,
      "동일한 소스·이미지로 검증된 v4 프로젝트 대상 5개가 모두 등록되어야 합니다.",
      "EDITOR_RENDER_V4_PROJECT_TARGETS_REQUIRED",
    );
  }
}

async function loadLatestEditorRenderV4Transition(
  tx: TransactionSql,
  releaseId: string | null = null,
) {
  const rows = releaseId
    ? await tx`
        select audit.action,audit.metadata->>'releaseId' as release_id
        from shorts_mvp.admin_audit_logs audit
        where audit.entity_type='editor_release'
          and audit.entity_id=${editorRenderV4AuditEntityId}
          and audit.action=any(${[...editorRenderV4ControlAuditActions]})
          and audit.metadata->>'releaseId'=${releaseId}
        order by audit.render_v4_event_sequence desc nulls last
        limit 1
      `
    : await tx`
        select audit.action,audit.metadata->>'releaseId' as release_id
        from shorts_mvp.admin_audit_logs audit
        where audit.entity_type='editor_release'
          and audit.entity_id=${editorRenderV4AuditEntityId}
          and audit.action=any(${[...editorRenderV4ControlAuditActions]})
        order by audit.render_v4_event_sequence desc nulls last
        limit 1
      `;
  return {
    action: rows[0]?.action ? String(rows[0].action) : null,
    releaseId: rows[0]?.releaseId ? String(rows[0].releaseId) : null,
  };
}

export async function addEditorReleaseTester(emailValue: string) {
  const email = emailSchema.parse(emailValue);
  const admin = await requireAdminUser();
  const result = await getDb().begin(async (tx) => {
    const users = await tx`
      select id,email,is_admin
      from shorts_mvp.app_users
      where lower(email)=lower(${email})
      limit 1
    `;
    const user = users[0];
    if (!user) throw new HttpError(404, "해당 이메일의 회원을 찾을 수 없습니다.");
    await tx`
      insert into shorts_mvp.editor_release_testers (
        user_id,enabled,created_by_user_id
      ) values (${user.id},true,${admin.id})
      on conflict (user_id) do update
      set enabled=true,updated_at=now()
    `;
    await recordAudit(
      tx,
      admin.id,
      "editor_release.tester_added",
      String(user.id),
      { email: String(user.email) },
    );
    return { id: String(user.id), email: String(user.email) };
  });
  revalidatePath(adminPath);
  return result;
}

export async function removeEditorReleaseTester(userIdValue: string) {
  const userId = uuidSchema.parse(userIdValue);
  const admin = await requireAdminUser();
  await getDb().begin(async (tx) => {
    const removed = await tx`
      update shorts_mvp.editor_release_testers
      set enabled=false
      where user_id=${userId} and enabled=true
      returning user_id
    `;
    if (!removed[0]) return;
    await recordAudit(
      tx,
      admin.id,
      "editor_release.tester_removed",
      userId,
      {},
    );
  });
  revalidatePath(adminPath);
}

export async function startEditorReleaseCanary(releaseIdValue: string) {
  const releaseId = uuidSchema.parse(releaseIdValue);
  const admin = await requireAdminUser();
  if (!editorRenderingV2MasterEnabled()) {
    throw new HttpError(
      409,
      "서버 마스터 스위치가 꺼져 있어 카나리를 시작할 수 없습니다.",
      "EDITOR_RELEASE_MASTER_DISABLED",
    );
  }
  await getDb().begin(async (tx) => {
    await assertEditorRenderV4InfrastructureLeaseInactive(tx);
    const states = await tx`
      select candidate_release_id,canary_enabled,
        render_v4_internal_enabled,render_v4_rollout_percent,
        render_v4_kill_switch
      from shorts_mvp.editor_release_state
      where singleton=true
      for update
    `;
    if (!states[0]) throw new HttpError(503, "편집기 릴리스 상태를 찾을 수 없습니다.");
    if (String(states[0].candidateReleaseId || "") !== releaseId) {
      throw new HttpError(
        409,
        "현재 등록된 candidate 릴리스만 카나리를 시작할 수 있습니다.",
      );
    }
    const releases = await tx`
      select id,status,git_sha,worker_image_digest,render_spec_version,
        caption_render_spec_version,font_manifest_sha256
      from shorts_mvp.editor_releases
      where id=${releaseId}
      for update
    `;
    const release = releases[0];
    if (!release || !["staging_verified", "canary_ready"].includes(release.status)) {
      throw new HttpError(409, "격리 검증을 통과한 후보만 카나리를 시작할 수 있습니다.");
    }
    if (Number(release.renderSpecVersion) === 4) {
      assertRenderV4EnvironmentEnabled();
      assertExactRenderV4Capability(release);
      assertRenderV4ProjectTargetEnvironment(release);
      await assertRenderV4ProjectTargetsRegistered(tx, releaseId);
    }
    await assertChecksPassed(
      tx,
      releaseId,
      "isolated",
      release.renderSpecVersion === 4 ? v4IsolatedChecks : isolatedChecks,
    );
    // A newly started editor canary must opt into unified v5 separately.
    await tx`
      update shorts_mvp.runtime_feature_flags
      set enabled=false,updated_by_user_id=${admin.id}
      where flag_key=${UNIFIED_TEMPLATE_SUBTITLES_CANARY_FLAG_KEY}
    `;
    await tx`
      update shorts_mvp.editor_releases
      set status='canary_active',canary_started_at=coalesce(canary_started_at,now())
      where id=${releaseId}
    `;
    const latestTransition = Number(release.renderSpecVersion) === 4
      ? await loadLatestEditorRenderV4Transition(tx)
      : { action: null, releaseId: null };
    const resetStoppedPriorRelease = Number(release.renderSpecVersion) === 4
      && Boolean(states[0].renderV4KillSwitch)
      && latestTransition.action === editorRenderV4EmergencyStoppedAction
      && latestTransition.releaseId !== null
      && latestTransition.releaseId !== releaseId;
    if (resetStoppedPriorRelease) {
      await tx`
        update shorts_mvp.editor_release_state
        set candidate_release_id=${releaseId},canary_enabled=true,
          render_v4_internal_enabled=false,
          render_v4_rollout_percent=0,
          render_v4_kill_switch=true,
          updated_by_user_id=${admin.id}
        where singleton=true
      `;
      await recordAudit(
        tx,
        admin.id,
        editorRenderV4StoppedForNewCandidateAction,
        editorRenderV4AuditEntityId,
        {
          releaseId,
          replacedEmergencyReleaseId: latestTransition.releaseId,
          previous: {
            internalEnabled: Boolean(states[0].renderV4InternalEnabled),
            rolloutPercent: Number(states[0].renderV4RolloutPercent || 0),
            killSwitch: Boolean(states[0].renderV4KillSwitch),
          },
          current: {
            internalEnabled: false,
            rolloutPercent: 0,
            killSwitch: true,
          },
          automaticPublicRolloutAllowed: false,
        },
      );
    } else {
      await tx`
        update shorts_mvp.editor_release_state
        set candidate_release_id=${releaseId},canary_enabled=true,
          updated_by_user_id=${admin.id}
        where singleton=true
      `;
    }
    await recordAudit(
      tx,
      admin.id,
      "editor_release.canary_started",
      releaseId,
      {
        gitSha: release.gitSha,
        workerImageDigest: release.workerImageDigest,
        unifiedTemplateSubtitlesCanaryEnabled: false,
      },
    );
  });
  revalidatePath(adminPath);
}

export async function pauseEditorReleaseCanary() {
  const admin = await requireAdminUser();
  await getDb().begin(async (tx) => {
    await assertEditorRenderV4InfrastructureLeaseInactive(tx);
    const states = await tx`
      select stable_release_id,candidate_release_id,canary_enabled,
        render_v4_internal_enabled,render_v4_rollout_percent,
        render_v4_kill_switch
      from shorts_mvp.editor_release_state
      where singleton=true
      for update
    `;
    const state = states[0];
    await tx`
      update shorts_mvp.runtime_feature_flags
      set enabled=false,updated_by_user_id=${admin.id}
      where flag_key=${UNIFIED_TEMPLATE_SUBTITLES_CANARY_FLAG_KEY}
    `;
    if (!state) return;
    const internalWasEnabled = Boolean(state.renderV4InternalEnabled);
    if (!state.candidateReleaseId || !state.canaryEnabled) {
      if (!internalWasEnabled) return;
      await tx`
        update shorts_mvp.editor_release_state
        set render_v4_internal_enabled=false,updated_by_user_id=${admin.id}
        where singleton=true
      `;
      await recordAudit(
        tx,
        admin.id,
        "editor_release.render_v4_internal_disabled",
        editorRenderV4AuditEntityId,
        {
          releaseId: String(
            state.candidateReleaseId || state.stableReleaseId || "",
          ) || null,
          reason: "canary_paused",
          rolloutPercent: Number(state.renderV4RolloutPercent || 0),
          killSwitch: Boolean(state.renderV4KillSwitch),
        },
      );
      return;
    }
    await tx`
      update shorts_mvp.editor_release_state
      set canary_enabled=false,render_v4_internal_enabled=false,
        updated_by_user_id=${admin.id}
      where singleton=true
    `;
    await tx`
      update shorts_mvp.editor_releases
      set status='canary_ready'
      where id=${state.candidateReleaseId} and status='canary_active'
    `;
    await recordAudit(
      tx,
      admin.id,
      "editor_release.canary_paused",
      String(state.candidateReleaseId),
      {
        unifiedTemplateSubtitlesCanaryEnabled: false,
        renderV4InternalDisabled: internalWasEnabled,
      },
    );
    if (internalWasEnabled) {
      await recordAudit(
        tx,
        admin.id,
        "editor_release.render_v4_internal_disabled",
        editorRenderV4AuditEntityId,
        {
          releaseId: String(state.candidateReleaseId),
          reason: "canary_paused",
          rolloutPercent: Number(state.renderV4RolloutPercent || 0),
          killSwitch: Boolean(state.renderV4KillSwitch),
        },
      );
    }
  });
  revalidatePath(adminPath);
}

export async function recordEditorReleaseCanaryCheck(
  releaseIdValue: string,
  checkNameValue: string,
  statusValue: "passed" | "failed",
) {
  const releaseId = uuidSchema.parse(releaseIdValue);
  const checkName = productionCanaryCheckSchema.parse(checkNameValue);
  const status = z.enum(["passed", "failed"]).parse(statusValue);
  const admin = await requireAdminUser();
  await getDb().begin(async (tx) => {
    const states = await tx`
      select state.candidate_release_id,state.canary_enabled,
        state.render_v4_internal_enabled,state.render_v4_kill_switch,
        release.render_spec_version
      from shorts_mvp.editor_release_state state
      left join shorts_mvp.editor_releases release
        on release.id=state.candidate_release_id
      where state.singleton=true
      for update of state
    `;
    if (
      !states[0]?.canaryEnabled
      || String(states[0]?.candidateReleaseId || "") !== releaseId
    ) {
      throw new HttpError(
        409,
        "현재 실행 중인 카나리 후보의 검사만 기록할 수 있습니다.",
      );
    }
    if (
      Number(states[0]?.renderSpecVersion) === 4
      && (
        !states[0]?.renderV4InternalEnabled
        || states[0]?.renderV4KillSwitch
      )
    ) {
      throw new HttpError(
        409,
        "v4 내부 렌더를 명시적으로 켠 상태에서 수행한 검사만 기록할 수 있습니다.",
        "EDITOR_RENDER_V4_INTERNAL_CANARY_REQUIRED",
      );
    }
    await tx`
      insert into shorts_mvp.editor_release_checks (
        release_id,environment,check_name,status,details,
        started_at,completed_at
      ) values (
        ${releaseId},'production_canary',${checkName},${status},
        ${tx.json({
          verification: "administrator_manual_canary",
          administratorUserId: admin.id,
        })},
        now(),now()
      )
      on conflict (release_id,environment,check_name) do update
      set status=excluded.status,details=excluded.details,
        started_at=excluded.started_at,completed_at=excluded.completed_at,
        updated_at=now()
    `;
    await recordAudit(
      tx,
      admin.id,
      `editor_release.canary_check_${status}`,
      releaseId,
      { checkName },
    );
  });
  revalidatePath(adminPath);
}

export async function enableEditorRenderV4Internal(releaseIdValue: string) {
  const releaseId = uuidSchema.parse(releaseIdValue);
  const admin = await requireAdminUser();
  if (!editorRenderingV2MasterEnabled()) {
    throw new HttpError(
      409,
      "서버 마스터 스위치가 꺼져 있어 v4 내부 검증을 시작할 수 없습니다.",
      "EDITOR_RELEASE_MASTER_DISABLED",
    );
  }
  assertRenderV4EnvironmentEnabled();
  await getDb().begin(async (tx) => {
    await assertEditorRenderV4InfrastructureLeaseInactive(tx);
    const states = await tx`
      select candidate_release_id,canary_enabled,
        render_v4_internal_enabled,render_v4_rollout_percent,
        render_v4_kill_switch
      from shorts_mvp.editor_release_state
      where singleton=true
      for update
    `;
    const state = states[0];
    if (
      !state?.canaryEnabled
      || String(state.candidateReleaseId || "") !== releaseId
    ) {
      throw new HttpError(
        409,
        "현재 실행 중인 후보 카나리에서만 v4 내부 렌더를 켤 수 있습니다.",
        "EDITOR_RENDER_V4_CANDIDATE_REQUIRED",
      );
    }
    const releases = await tx`
      select id,status,render_spec_version,caption_render_spec_version,
        font_manifest_sha256
      from shorts_mvp.editor_releases
      where id=${releaseId}
      for update
    `;
    const release = releases[0];
    if (!release || release.status !== "canary_active") {
      throw new HttpError(409, "실행 중인 후보 카나리 상태가 아닙니다.");
    }
    assertExactRenderV4Capability(release);
    assertRenderV4ProjectTargetEnvironment(release);
    await assertRenderV4ProjectTargetsRegistered(tx, releaseId);
    await assertChecksPassed(tx, releaseId, "isolated", v4IsolatedChecks);
    const enabledTesters = await tx`
      select count(*)::integer as count
      from shorts_mvp.editor_release_testers
      where enabled=true
    `;
    if (Number(enabledTesters[0]?.count || 0) === 0) {
      throw new HttpError(
        409,
        "v4 내부 검증을 시작하려면 활성화된 내부 테스트 계정이 필요합니다.",
        "EDITOR_RENDER_V4_TESTER_REQUIRED",
      );
    }
    const rolloutPercent = Number(state.renderV4RolloutPercent || 0);
    const killSwitch = Boolean(state.renderV4KillSwitch);
    const latestTransition = await loadLatestEditorRenderV4Transition(
      tx,
      releaseId,
    );
    if (
      killSwitch
      && isEditorRenderV4EmergencyForRelease(
        latestTransition.action,
        latestTransition.releaseId,
        releaseId,
      )
    ) {
      throw new HttpError(
        409,
        "긴급 중단된 릴리스는 다시 활성화할 수 없습니다. 새 검증 릴리스를 등록해 주세요.",
        "EDITOR_RENDER_V4_NEW_RELEASE_REQUIRED",
      );
    }
    if (!canEnableEditorRenderV4Internal(
      rolloutPercent,
      killSwitch,
      latestTransition.action,
      latestTransition.releaseId,
      releaseId,
    )) {
      throw new HttpError(
        409,
        "중단된 v4 상태는 내부 활성화로 해제할 수 없습니다. 새 검증 릴리스를 등록해 주세요.",
        "EDITOR_RENDER_V4_STOPPED_PUBLIC_ROLLOUT",
      );
    }
    if (state.renderV4InternalEnabled && !killSwitch) return;
    await tx`
      update shorts_mvp.editor_release_state
      set render_v4_internal_enabled=true,render_v4_kill_switch=false,
        updated_by_user_id=${admin.id}
      where singleton=true
    `;
    await recordAudit(
      tx,
      admin.id,
      "editor_release.render_v4_internal_enabled",
      editorRenderV4AuditEntityId,
      {
        releaseId,
        previous: {
          internalEnabled: Boolean(state.renderV4InternalEnabled),
          rolloutPercent,
          killSwitch,
        },
        current: {
          internalEnabled: true,
          rolloutPercent,
          killSwitch: false,
        },
        requiredChecks: [...v4IsolatedChecks],
      },
    );
  });
  revalidatePath(adminPath);
}

export async function emergencyStopEditorRenderV4() {
  const admin = await requireAdminUser();
  await getDb().begin(async (tx) => {
    const states = await tx`
      select stable_release_id,candidate_release_id,
        render_v4_internal_enabled,render_v4_rollout_percent,
        render_v4_kill_switch
      from shorts_mvp.editor_release_state
      where singleton=true
      for update
    `;
    const state = states[0];
    if (!state) {
      throw new HttpError(503, "편집기 릴리스 상태를 찾을 수 없습니다.");
    }
    if (state.renderV4KillSwitch && !state.renderV4InternalEnabled) return;
    const rolloutPercent = Number(state.renderV4RolloutPercent || 0);
    const releaseIds = [...new Set([
      state.stableReleaseId,
      state.candidateReleaseId,
    ].filter(Boolean).map(String))];
    await tx`
      update shorts_mvp.editor_release_state
      set render_v4_internal_enabled=false,render_v4_kill_switch=true,
        updated_by_user_id=${admin.id}
      where singleton=true
    `;
    for (const releaseId of releaseIds.length > 0 ? releaseIds : [null]) {
      await recordAudit(
        tx,
        admin.id,
        editorRenderV4EmergencyStoppedAction,
        editorRenderV4AuditEntityId,
        {
          releaseId,
          previous: {
            internalEnabled: Boolean(state.renderV4InternalEnabled),
            rolloutPercent,
            killSwitch: Boolean(state.renderV4KillSwitch),
          },
          current: {
            internalEnabled: false,
            rolloutPercent,
            killSwitch: true,
          },
          automaticResumeAllowed: false,
        },
      );
    }
  });
  revalidatePath(adminPath);
}

async function loadStableRenderV4RolloutState(
  tx: TransactionSql,
  releaseId: string,
) {
  await assertEditorRenderV4InfrastructureLeaseInactive(tx);
  const states = await tx`
    select state.stable_release_id,state.public_enabled,
      state.render_v4_internal_enabled,state.render_v4_rollout_percent,
      state.render_v4_kill_switch,
      coalesce(flag.enabled,false) as runtime_enabled,
      release.status,release.promoted_at,release.render_spec_version,
      release.caption_render_spec_version,release.font_manifest_sha256
    from shorts_mvp.editor_release_state state
    left join shorts_mvp.runtime_feature_flags flag
      on flag.flag_key=${EDITOR_RENDERING_V2_FLAG_KEY}
    join shorts_mvp.editor_releases release
      on release.id=state.stable_release_id
    where state.singleton=true
    limit 1
    for update of state,release
  `;
  const state = states[0];
  if (
    !state?.publicEnabled
    || !state.runtimeEnabled
    || String(state.stableReleaseId || "") !== releaseId
    || state.status !== "stable"
    || !state.promotedAt
  ) {
    throw new HttpError(
      409,
      "현재 공개 중인 stable 릴리스만 v4 공개 비율을 변경할 수 있습니다.",
      "EDITOR_RENDER_V4_STABLE_REQUIRED",
    );
  }
  assertExactRenderV4Capability(state);
  assertRenderV4ProjectTargetEnvironment(state);
  const renderV4LastTransition = await loadLatestEditorRenderV4Transition(
    tx,
    releaseId,
  );
  return {
    renderV4RolloutPercent: Number(state.renderV4RolloutPercent || 0),
    renderV4KillSwitch: Boolean(state.renderV4KillSwitch),
    renderV4LastTransition,
  };
}

export async function advanceEditorRenderV4Rollout(
  releaseIdValue: string,
  targetPercentValue: number,
) {
  const releaseId = uuidSchema.parse(releaseIdValue);
  const targetPercent = renderV4PublicRolloutSchema.parse(targetPercentValue);
  const admin = await requireAdminUser();
  if (!editorRenderingV2MasterEnabled() || !editorRenderingV2GlobalEnabled()) {
    throw new HttpError(
      409,
      "서버의 편집기 전체 공개 스위치를 먼저 활성화해야 합니다.",
      "EDITOR_RELEASE_PUBLIC_ENV_DISABLED",
    );
  }
  assertRenderV4EnvironmentEnabled();
  await getDb().begin(async (tx) => {
    const state = await loadStableRenderV4RolloutState(tx, releaseId);
    const currentPercent = Number(state.renderV4RolloutPercent || 0);
    const killSwitch = Boolean(state.renderV4KillSwitch);
    const expectedPercent = nextEditorRenderV4RolloutPercent(
      currentPercent,
      killSwitch,
    );
    if (
      killSwitch
      && isEditorRenderV4EmergencyForRelease(
        state.renderV4LastTransition.action,
        state.renderV4LastTransition.releaseId,
        releaseId,
      )
    ) {
      throw new HttpError(
        409,
        "긴급 중단된 릴리스는 다시 공개할 수 없습니다. 새 검증 릴리스를 승격해 주세요.",
        "EDITOR_RENDER_V4_NEW_RELEASE_REQUIRED",
      );
    }
    if (expectedPercent !== targetPercent) {
      throw new HttpError(
        409,
        killSwitch && currentPercent > 0
          ? "긴급 중단된 공개는 재개할 수 없습니다. 새 검증 릴리스를 승격해 주세요."
          : `v4 공개는 ${currentPercent}% 다음의 정해진 단계로만 진행할 수 있습니다.`,
        "EDITOR_RENDER_V4_ROLLOUT_SEQUENCE_REQUIRED",
      );
    }
    await assertRenderV4CanaryEvidence(tx, releaseId);
    const updated = await tx`
      update shorts_mvp.editor_release_state
      set render_v4_rollout_percent=${targetPercent},
        render_v4_kill_switch=false,updated_by_user_id=${admin.id}
      where singleton=true
        and stable_release_id=${releaseId}
        and render_v4_rollout_percent=${currentPercent}
        and render_v4_kill_switch=${killSwitch}
      returning singleton
    `;
    if (updated.length !== 1) {
      throw new HttpError(409, "v4 공개 상태가 변경되어 다시 확인해야 합니다.");
    }
    await recordAudit(
      tx,
      admin.id,
      "editor_release.render_v4_rollout_advanced",
      editorRenderV4AuditEntityId,
      {
        releaseId,
        previous: {
          rolloutPercent: currentPercent,
          killSwitch,
        },
        current: {
          rolloutPercent: targetPercent,
          killSwitch: false,
        },
        requiredChecks: {
          isolated: [...v4IsolatedChecks],
          productionCanary: [...productionCanaryChecks],
          successfulRenderMinimum: 1,
        },
      },
    );
  });
  revalidatePath(adminPath);
}

export async function promoteEditorRelease(releaseIdValue: string) {
  const releaseId = uuidSchema.parse(releaseIdValue);
  const admin = await requireAdminUser();
  if (!editorRenderingV2MasterEnabled() || !editorRenderingV2GlobalEnabled()) {
    throw new HttpError(
      409,
      "서버의 전체 공개 스위치를 먼저 활성화해야 합니다.",
      "EDITOR_RELEASE_PUBLIC_ENV_DISABLED",
    );
  }
  await getDb().begin(async (tx) => {
    await assertEditorRenderV4InfrastructureLeaseInactive(tx);
    const states = await tx`
      select stable_release_id,candidate_release_id,canary_enabled,
        render_v4_internal_enabled,render_v4_rollout_percent,
        render_v4_kill_switch
      from shorts_mvp.editor_release_state
      where singleton=true
      for update
    `;
    const state = states[0];
    if (
      !state?.canaryEnabled
      || String(state.candidateReleaseId || "") !== releaseId
    ) {
      throw new HttpError(409, "현재 실행 중인 카나리 후보만 승격할 수 있습니다.");
    }
    const releases = await tx`
      select id,status,git_sha,worker_image_digest,render_spec_version,
        caption_render_spec_version,font_manifest_sha256
      from shorts_mvp.editor_releases
      where id=${releaseId}
      for update
    `;
    const release = releases[0];
    if (!release || release.status !== "canary_active") {
      throw new HttpError(409, "카나리 실행 상태가 올바르지 않습니다.");
    }
    const isRenderV4Release = Number(release.renderSpecVersion) === 4;
    if (isRenderV4Release) {
      assertRenderV4EnvironmentEnabled();
      assertExactRenderV4Capability(release);
      assertRenderV4ProjectTargetEnvironment(release);
      await assertRenderV4ProjectTargetsRegistered(tx, releaseId);
      if (!state.renderV4InternalEnabled || state.renderV4KillSwitch) {
        throw new HttpError(
          409,
          "v4 내부 렌더가 활성화된 상태의 카나리만 승격할 수 있습니다.",
          "EDITOR_RENDER_V4_INTERNAL_CANARY_REQUIRED",
        );
      }
    }
    await assertChecksPassed(
      tx,
      releaseId,
      "isolated",
      release.renderSpecVersion === 4 ? v4IsolatedChecks : isolatedChecks,
    );
    await assertChecksPassed(
      tx,
      releaseId,
      "production_canary",
      productionCanaryChecks,
    );
    await assertCanaryRenderEvidence(tx, releaseId);
    await tx`
      update shorts_mvp.editor_releases
      set status='approved',approved_by_user_id=${admin.id},
        approved_at=now()
      where id=${releaseId}
    `;
    if (isRenderV4Release) {
      await tx`
        update shorts_mvp.editor_release_state
        set previous_stable_release_id=stable_release_id,
          stable_release_id=${releaseId},
          candidate_release_id=null,
          public_enabled=true,canary_enabled=false,
          render_v4_internal_enabled=false,
          render_v4_rollout_percent=0,
          render_v4_kill_switch=true,
          updated_by_user_id=${admin.id}
        where singleton=true
      `;
      await recordAudit(
        tx,
        admin.id,
        editorRenderV4StoppedOnPromotionAction,
        editorRenderV4AuditEntityId,
        {
          releaseId,
          previous: {
            internalEnabled: Boolean(state.renderV4InternalEnabled),
            rolloutPercent: Number(state.renderV4RolloutPercent || 0),
            killSwitch: Boolean(state.renderV4KillSwitch),
          },
          current: {
            internalEnabled: false,
            rolloutPercent: 0,
            killSwitch: true,
          },
          automaticPublicRolloutAllowed: false,
        },
      );
    } else {
      await tx`
        update shorts_mvp.editor_release_state
        set previous_stable_release_id=stable_release_id,
          stable_release_id=${releaseId},
          candidate_release_id=null,
          public_enabled=true,canary_enabled=false,
          updated_by_user_id=${admin.id}
        where singleton=true
      `;
    }
    await tx`
      update shorts_mvp.editor_releases
      set status='stable',promoted_at=now()
      where id=${releaseId} and status='approved'
    `;
    await tx`
      update shorts_mvp.runtime_feature_flags
      set enabled=true,updated_by_user_id=${admin.id}
      where flag_key=${EDITOR_RENDERING_V2_FLAG_KEY}
    `;
    await recordAudit(
      tx,
      admin.id,
      "editor_release.promoted",
      releaseId,
      {
        previousStableReleaseId: state.stableReleaseId || null,
        gitSha: release.gitSha,
        workerImageDigest: release.workerImageDigest,
        rolloutPercent: isRenderV4Release ? 0 : 100,
        renderV4Stopped: isRenderV4Release,
      },
    );
  });
  revalidatePath(adminPath);
}

export async function publishSubtitleSuite() {
  const admin = await requireAdminUser();
  if (
    process.env.SUBTITLE_TEMPLATES_ENABLED?.trim().toLowerCase() !== "true"
    || process.env.ELEVENLABS_TRANSCRIPTION_ENABLED?.trim().toLowerCase()
      !== "true"
  ) {
    throw new HttpError(
      409,
      "자막 템플릿과 ElevenLabs 서버 마스터 스위치를 먼저 확인해 주세요.",
      "SUBTITLE_SUITE_MASTER_DISABLED",
    );
  }
  await getDb().begin(async (tx) => {
    const states = await tx`
      select state.stable_release_id,state.public_enabled,
        release.status,release.subtitle_editing_capable
      from shorts_mvp.editor_release_state state
      join shorts_mvp.editor_releases release
        on release.id=state.stable_release_id
      where state.singleton=true
      limit 1
      for update of state,release
    `;
    const state = states[0];
    if (
      !state?.stableReleaseId
      || !state.publicEnabled
      || state.status !== "stable"
      || state.subtitleEditingCapable !== true
    ) {
      throw new HttpError(
        409,
        "자막 편집 검증을 통과한 stable 릴리스를 먼저 승격해 주세요.",
        "SUBTITLE_SUITE_STABLE_REQUIRED",
      );
    }
    const releaseId = String(state.stableReleaseId);
    const renderCounts = await tx`
      select
        count(*) filter (
          where status in ('queued','rendering')
        )::integer as active,
        count(*) filter (where status='failed')::integer as failed
      from shorts_mvp.editor_render_requests
      where release_id=${releaseId}
    `;
    if (Number(renderCounts[0]?.active || 0) > 0) {
      throw new HttpError(
        409,
        "일반 사용자 검증 렌더가 끝난 뒤 공개해 주세요.",
        "SUBTITLE_SUITE_RENDER_ACTIVE",
      );
    }
    if (Number(renderCounts[0]?.failed || 0) > 0) {
      throw new HttpError(
        409,
        "실패한 자막 검증 렌더가 있어 공개할 수 없습니다.",
        "SUBTITLE_SUITE_RENDER_FAILED",
      );
    }
    const pilotEvidence = await tx`
      select count(distinct j.id)::integer as verified_projects
      from shorts_mvp.editor_render_requests request
      join shorts_mvp.generated_shorts s on s.id=request.short_id
      join shorts_mvp.video_jobs j on j.id=s.job_id
      join shorts_mvp.editor_release_testers tester
        on tester.user_id=j.user_id and tester.enabled=true
      join shorts_mvp.app_users pilot_user
        on pilot_user.id=j.user_id and pilot_user.is_admin=false
      where request.release_id=${releaseId}
        and request.status='succeeded'
        and j.status='completed'
        and j.transcription_policy='elevenlabs_primary_openai_fallback'
    `;
    const verifiedProjects = Number(
      pilotEvidence[0]?.verifiedProjects || 0,
    );
    if (verifiedProjects < 3) {
      throw new HttpError(
        409,
        `일반 사용자 프로젝트 3건 검증이 필요합니다. 현재 ${verifiedProjects}건입니다.`,
        "SUBTITLE_SUITE_PILOT_INCOMPLETE",
      );
    }
    const publicFlagKeys = [
      EDITOR_SUBTITLE_EDITING_PUBLIC_FLAG_KEY,
      ELEVENLABS_TRANSCRIPTION_PUBLIC_FLAG_KEY,
      SUBTITLE_TEMPLATES_PUBLIC_FLAG_KEY,
    ];
    const requiredFlagKeys = [
      EDITOR_RENDERING_V2_FLAG_KEY,
      ELEVENLABS_TRANSCRIPTION_FLAG_KEY,
      SUBTITLE_TEMPLATES_FLAG_KEY,
      ELEVENLABS_PUBLIC_COMPLIANCE_APPROVED_FLAG_KEY,
    ];
    const requiredFlags = await tx`
      select flag_key,enabled
      from shorts_mvp.runtime_feature_flags
      where flag_key=any(${requiredFlagKeys})
      for update
    `;
    if (
      requiredFlags.length !== requiredFlagKeys.length
      || requiredFlags.some((flag) => flag.enabled !== true)
    ) {
      throw new HttpError(
        409,
        "자막 기능의 런타임 스위치와 ElevenLabs 공개 준수 승인을 먼저 확인해 주세요.",
        "SUBTITLE_SUITE_APPROVAL_REQUIRED",
      );
    }
    const updatedFlags = await tx`
      update shorts_mvp.runtime_feature_flags
      set enabled=true,updated_by_user_id=${admin.id}
      where flag_key=any(${publicFlagKeys})
      returning flag_key
    `;
    if (updatedFlags.length !== publicFlagKeys.length) {
      throw new HttpError(
        409,
        "자막 공개 플래그 구성이 완전하지 않습니다.",
        "SUBTITLE_SUITE_FLAGS_MISSING",
      );
    }
    await recordAudit(
      tx,
      admin.id,
      "editor_release.subtitle_suite_published",
      releaseId,
      { verifiedProjects, publicFlagKeys },
    );
  });
  revalidatePath(adminPath);
}

export async function setUnifiedTemplateSubtitleCanary(
  enabledValue: boolean,
) {
  const enabled = z.boolean().parse(enabledValue);
  const admin = await requireAdminUser();
  if (
    enabled
    && process.env.SUBTITLE_TEMPLATES_ENABLED?.trim().toLowerCase() !== "true"
  ) {
    throw new HttpError(
      409,
      "자막 템플릿 서버 마스터 스위치를 먼저 켜 주세요.",
      "UNIFIED_TEMPLATE_SUBTITLE_MASTER_DISABLED",
    );
  }
  await getDb().begin(async (tx) => {
    const flagRows = await tx`
      select flag_key,enabled
      from shorts_mvp.runtime_feature_flags
      where flag_key in (
        ${SUBTITLE_TEMPLATES_FLAG_KEY},
        ${UNIFIED_TEMPLATE_SUBTITLES_CANARY_FLAG_KEY}
      )
      for update
    `;
    const baseFlag = flagRows.find(
      (flag) => flag.flagKey === SUBTITLE_TEMPLATES_FLAG_KEY,
    );
    const unifiedFlag = flagRows.find(
      (flag) => flag.flagKey === UNIFIED_TEMPLATE_SUBTITLES_CANARY_FLAG_KEY,
    );
    if (!unifiedFlag) {
      throw new HttpError(
        503,
        "통합 템플릿 자막 카나리 플래그 마이그레이션이 필요합니다.",
        "UNIFIED_TEMPLATE_SUBTITLE_FLAG_MISSING",
      );
    }

    let candidateReleaseId: string | null = null;
    if (enabled) {
      if (baseFlag?.enabled !== true) {
        throw new HttpError(
          409,
          "기존 자막 템플릿 런타임 스위치를 먼저 켜 주세요.",
          "SUBTITLE_TEMPLATES_RUNTIME_DISABLED",
        );
      }
      const states = await tx`
        select state.candidate_release_id,state.canary_enabled,
          release.status,release.subtitle_editing_capable
        from shorts_mvp.editor_release_state state
        left join shorts_mvp.editor_releases release
          on release.id=state.candidate_release_id
        where state.singleton=true
        for update of state
      `;
      const state = states[0];
      if (
        !state?.canaryEnabled
        || !state.candidateReleaseId
        || state.status !== "canary_active"
        || state.subtitleEditingCapable !== true
      ) {
        throw new HttpError(
          409,
          "자막 편집 capability가 검증된 운영 카나리 릴리스를 먼저 시작해 주세요.",
          "UNIFIED_TEMPLATE_SUBTITLE_RELEASE_REQUIRED",
        );
      }
      candidateReleaseId = String(state.candidateReleaseId);
    }

    const updated = await tx`
      update shorts_mvp.runtime_feature_flags
      set enabled=${enabled},updated_by_user_id=${admin.id}
      where flag_key=${UNIFIED_TEMPLATE_SUBTITLES_CANARY_FLAG_KEY}
      returning flag_key
    `;
    if (updated.length !== 1) {
      throw new HttpError(
        503,
        "통합 템플릿 자막 카나리 플래그를 변경하지 못했습니다.",
        "UNIFIED_TEMPLATE_SUBTITLE_FLAG_MISSING",
      );
    }
    await recordAudit(
      tx,
      admin.id,
      enabled
        ? "editor_release.unified_template_subtitles_canary_enabled"
        : "editor_release.unified_template_subtitles_canary_disabled",
      candidateReleaseId || UNIFIED_TEMPLATE_SUBTITLES_CANARY_FLAG_KEY,
      {
        enabled,
        candidateReleaseId,
        rollbackScope: "unified_template_subtitles_v5_only",
      },
    );
  });
  revalidatePath(adminPath);
}

export async function setUnifiedTemplateSubtitlePublic(
  enabledValue: boolean,
) {
  const enabled = z.boolean().parse(enabledValue);
  const admin = await requireAdminUser();
  if (enabled && (
    process.env.SUBTITLE_TEMPLATES_ENABLED?.trim().toLowerCase() !== "true"
    || process.env.ELEVENLABS_TRANSCRIPTION_ENABLED?.trim().toLowerCase()
      !== "true"
    || !editorRenderingV2MasterEnabled()
    || !editorRenderingV2GlobalEnabled()
    || !process.env.UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN?.trim()
    || !process.env.UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN?.trim()
  )) {
    throw new HttpError(
      409,
      "통합 자막 템플릿의 서버·전사·렌더 대상을 먼저 확인해 주세요.",
      "UNIFIED_TEMPLATE_SUBTITLE_PUBLIC_MASTER_DISABLED",
    );
  }
  await getDb().begin(async (tx) => {
    let releaseId: string | null = null;
    let completedProjects = 0;
    let readyShorts = 0;
    if (enabled) {
      const states = await tx`
        select state.stable_release_id,state.public_enabled,
          release.status,release.document_version,
          release.subtitle_editing_capable
        from shorts_mvp.editor_release_state state
        join shorts_mvp.editor_releases release
          on release.id=state.stable_release_id
        where state.singleton=true
        limit 1
        for update of state,release
      `;
      const state = states[0];
      if (
        !state?.stableReleaseId
        || state.publicEnabled !== true
        || state.status !== "stable"
        || Number(state.documentVersion) !== 3
        || state.subtitleEditingCapable !== true
      ) {
        throw new HttpError(
          409,
          "자막 편집이 가능한 stable 릴리스를 먼저 공개해 주세요.",
          "UNIFIED_TEMPLATE_SUBTITLE_PUBLIC_STABLE_REQUIRED",
        );
      }
      releaseId = String(state.stableReleaseId);
      const requiredFlagKeys = [
        EDITOR_RENDERING_V2_FLAG_KEY,
        EDITOR_SUBTITLE_EDITING_PUBLIC_FLAG_KEY,
        ELEVENLABS_TRANSCRIPTION_FLAG_KEY,
        ELEVENLABS_TRANSCRIPTION_PUBLIC_FLAG_KEY,
        ELEVENLABS_PUBLIC_COMPLIANCE_APPROVED_FLAG_KEY,
        SUBTITLE_TEMPLATES_FLAG_KEY,
        SUBTITLE_TEMPLATES_PUBLIC_FLAG_KEY,
      ];
      const flags = await tx`
        select flag_key,enabled
        from shorts_mvp.runtime_feature_flags
        where flag_key=any(${requiredFlagKeys})
        for update
      `;
      if (
        flags.length !== requiredFlagKeys.length
        || flags.some((flag) => flag.enabled !== true)
      ) {
        throw new HttpError(
          409,
          "자막 템플릿·편집·전사 공개 스위치를 먼저 확인해 주세요.",
          "UNIFIED_TEMPLATE_SUBTITLE_PUBLIC_FLAGS_REQUIRED",
        );
      }
      const evidence = await tx`
        select
          count(distinct job.id) filter (
            where job.status='completed'
          )::integer as completed_projects,
          count(distinct short.id) filter (
            where short.status='ready'
          )::integer as ready_shorts,
          count(distinct job.id) filter (
            where job.status in (
              'validating','queued','starting','downloading','transcribing',
              'selecting','extracting','rendering','uploading','retry_waiting'
            )
          )::integer as active_projects
        from shorts_mvp.video_jobs job
        left join shorts_mvp.generated_shorts short
          on short.job_id=job.id
          and short.subtitle_template_snapshot->>'origin'='unified-template-v5'
        where job.subtitle_template_snapshot->>'origin'='unified-template-v5'
      `;
      completedProjects = Number(evidence[0]?.completedProjects || 0);
      readyShorts = Number(evidence[0]?.readyShorts || 0);
      if (Number(evidence[0]?.activeProjects || 0) > 0) {
        throw new HttpError(
          409,
          "진행 중인 통합 자막 템플릿 작업이 끝난 뒤 공개해 주세요.",
          "UNIFIED_TEMPLATE_SUBTITLE_PUBLIC_ACTIVE_JOBS",
        );
      }
      if (completedProjects < 1 || readyShorts < 1) {
        throw new HttpError(
          409,
          "통합 자막 템플릿의 성공 프로젝트와 완성 영상 검증이 필요합니다.",
          "UNIFIED_TEMPLATE_SUBTITLE_PUBLIC_EVIDENCE_REQUIRED",
        );
      }
    }
    const updated = await tx`
      update shorts_mvp.runtime_feature_flags
      set enabled=${enabled},updated_by_user_id=${admin.id}
      where flag_key=${UNIFIED_TEMPLATE_SUBTITLES_PUBLIC_FLAG_KEY}
      returning flag_key
    `;
    if (updated.length !== 1) {
      throw new HttpError(
        503,
        "통합 자막 템플릿 공개 플래그 마이그레이션이 필요합니다.",
        "UNIFIED_TEMPLATE_SUBTITLE_PUBLIC_FLAG_MISSING",
      );
    }
    await recordAudit(
      tx,
      admin.id,
      enabled
        ? "editor_release.unified_template_subtitles_published"
        : "editor_release.unified_template_subtitles_unpublished",
      releaseId || UNIFIED_TEMPLATE_SUBTITLES_PUBLIC_FLAG_KEY,
      {
        enabled,
        releaseId,
        completedProjects,
        readyShorts,
        rollbackScope: "new_unified_template_subtitle_admissions",
      },
    );
  });
  revalidatePath(adminPath);
  revalidatePath("/templates");
  revalidatePath("/");
}

export async function rollbackEditorRelease(modeValue: "previous" | "legacy") {
  const mode = z.enum(["previous", "legacy"]).parse(modeValue);
  const admin = await requireAdminUser();
  await getDb().begin(async (tx) => {
    await assertEditorRenderV4InfrastructureLeaseInactive(tx);
    const states = await tx`
      select stable_release_id,previous_stable_release_id,candidate_release_id,
        public_enabled,canary_enabled,render_v4_internal_enabled,
        render_v4_rollout_percent,render_v4_kill_switch
      from shorts_mvp.editor_release_state
      where singleton=true
      for update
    `;
    const state = states[0];
    if (!state) throw new HttpError(503, "편집기 릴리스 상태를 찾을 수 없습니다.");
    await tx`
      update shorts_mvp.runtime_feature_flags
      set enabled=false,updated_by_user_id=${admin.id}
      where flag_key in (
        ${EDITOR_SUBTITLE_EDITING_PUBLIC_FLAG_KEY},
        ${ELEVENLABS_TRANSCRIPTION_PUBLIC_FLAG_KEY},
        ${SUBTITLE_TEMPLATES_PUBLIC_FLAG_KEY},
        ${UNIFIED_TEMPLATE_SUBTITLES_CANARY_FLAG_KEY},
        ${UNIFIED_TEMPLATE_SUBTITLES_PUBLIC_FLAG_KEY}
      )
    `;
    const currentReleaseId = state.stableReleaseId
      ? String(state.stableReleaseId)
      : null;
    const candidateReleaseId = state.candidateReleaseId
      ? String(state.candidateReleaseId)
      : null;
    if (mode === "previous" && !state.previousStableReleaseId) {
      throw new HttpError(409, "되돌릴 이전 stable 릴리스가 없습니다.");
    }
    const rollbackTargetReleaseId = mode === "previous"
      ? String(state.previousStableReleaseId)
      : null;
    const affectedReleaseIds = Array.from(new Set([
      currentReleaseId,
      candidateReleaseId,
      rollbackTargetReleaseId,
    ].filter((value): value is string => Boolean(value))));
    const affectedRenderV4Releases = affectedReleaseIds.length > 0
      ? await tx`
          select id
          from shorts_mvp.editor_releases
          where id=any(${affectedReleaseIds})
            and render_spec_version=4
            and caption_render_spec_version=4
        `
      : [];
    const affectedRenderV4ReleaseIds = new Set(
      affectedRenderV4Releases.map((release) => String(release.id)),
    );
    const rollbackTargetIsRenderV4 = Boolean(
      rollbackTargetReleaseId
      && affectedRenderV4ReleaseIds.has(rollbackTargetReleaseId),
    );
    const rollbackRolloutPercent = rollbackTargetIsRenderV4
      ? Number(state.renderV4RolloutPercent || 0)
      : 0;
    if (currentReleaseId) {
      await tx`
        update shorts_mvp.editor_releases
        set status='rolled_back',rolled_back_at=now()
        where id=${currentReleaseId}
      `;
    }
    if (
      candidateReleaseId
      && candidateReleaseId !== currentReleaseId
      && candidateReleaseId !== String(state.previousStableReleaseId || "")
    ) {
      await tx`
        update shorts_mvp.editor_releases
        set status='rolled_back',rolled_back_at=now()
        where id=${candidateReleaseId}
          and status in ('staging_verified','canary_ready','canary_active','approved')
      `;
    }
    if (mode === "previous") {
      await tx`
        update shorts_mvp.editor_releases
        set status='stable',rolled_back_at=null
        where id=${state.previousStableReleaseId}
      `;
      await tx`
        update shorts_mvp.editor_release_state
        set stable_release_id=${state.previousStableReleaseId},
          previous_stable_release_id=${currentReleaseId},
          candidate_release_id=null,
          public_enabled=true,canary_enabled=false,
          render_v4_internal_enabled=false,
          render_v4_rollout_percent=${rollbackRolloutPercent},
          render_v4_kill_switch=true,
          updated_by_user_id=${admin.id}
        where singleton=true
      `;
      await tx`
        update shorts_mvp.runtime_feature_flags
        set enabled=true,updated_by_user_id=${admin.id}
        where flag_key=${EDITOR_RENDERING_V2_FLAG_KEY}
      `;
    } else {
      await tx`
        update shorts_mvp.editor_release_state
        set previous_stable_release_id=${currentReleaseId},
          stable_release_id=null,candidate_release_id=null,
          public_enabled=false,canary_enabled=false,
          render_v4_internal_enabled=false,
          render_v4_rollout_percent=0,
          render_v4_kill_switch=true,
          updated_by_user_id=${admin.id}
        where singleton=true
      `;
      await tx`
        update shorts_mvp.runtime_feature_flags
        set enabled=false,updated_by_user_id=${admin.id}
        where flag_key=${EDITOR_RENDERING_V2_FLAG_KEY}
      `;
    }
    await recordAudit(
      tx,
      admin.id,
      "editor_release.rolled_back",
      currentReleaseId || "legacy",
      {
        mode,
        targetReleaseId: mode === "previous"
          ? String(state.previousStableReleaseId)
          : null,
        cancelledCandidateReleaseId: candidateReleaseId,
        renderV4: {
          previous: {
            internalEnabled: Boolean(state.renderV4InternalEnabled),
            rolloutPercent: Number(state.renderV4RolloutPercent || 0),
            killSwitch: Boolean(state.renderV4KillSwitch),
          },
          current: {
            internalEnabled: false,
            rolloutPercent: rollbackRolloutPercent,
            killSwitch: true,
          },
          automaticResumeAllowed: false,
        },
      },
    );
    if (
      affectedRenderV4Releases.length > 0
      || state.renderV4InternalEnabled
      || Number(state.renderV4RolloutPercent || 0) > 0
    ) {
      const scopedReleaseIds = affectedRenderV4ReleaseIds.size > 0
        ? [...affectedRenderV4ReleaseIds]
        : [currentReleaseId || candidateReleaseId];
      for (const releaseId of scopedReleaseIds) {
        await recordAudit(
          tx,
          admin.id,
          editorRenderV4EmergencyStoppedAction,
          editorRenderV4AuditEntityId,
          {
            releaseId,
            affectedRenderV4ReleaseIds: [...affectedRenderV4ReleaseIds],
            reason: `editor_release_rollback_${mode}`,
            rolloutPercent: rollbackRolloutPercent,
            automaticResumeAllowed: false,
          },
        );
      }
    }
  });
  revalidatePath(adminPath);
}
