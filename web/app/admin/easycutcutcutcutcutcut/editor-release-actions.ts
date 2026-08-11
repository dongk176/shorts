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
  ELEVENLABS_PUBLIC_COMPLIANCE_APPROVED_FLAG_KEY,
  ELEVENLABS_TRANSCRIPTION_FLAG_KEY,
  ELEVENLABS_TRANSCRIPTION_PUBLIC_FLAG_KEY,
} from "@/lib/transcription-release";
import {
  SUBTITLE_TEMPLATES_FLAG_KEY,
  SUBTITLE_TEMPLATES_PUBLIC_FLAG_KEY,
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
const productionCanaryChecks = [
  "save-render-download",
  "gemini-comments",
  "reopen-reedit",
  "rollback-drill",
] as const;
const productionCanaryCheckSchema = z.enum(productionCanaryChecks);

async function recordAudit(
  tx: TransactionSql,
  actorUserId: string,
  action: string,
  entityId: string,
  metadata: JSONValue,
) {
  await tx`
    insert into shorts_mvp.admin_audit_logs (
      actor_user_id,action,entity_type,entity_id,metadata
    ) values (
      ${actorUserId},${action},'editor_release',${entityId},
      ${tx.json(metadata)}
    )
  `;
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
    const states = await tx`
      select candidate_release_id,canary_enabled
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
      select id,status,git_sha,worker_image_digest
      from shorts_mvp.editor_releases
      where id=${releaseId}
      for update
    `;
    const release = releases[0];
    if (!release || !["staging_verified", "canary_ready"].includes(release.status)) {
      throw new HttpError(409, "격리 검증을 통과한 후보만 카나리를 시작할 수 있습니다.");
    }
    await assertChecksPassed(tx, releaseId, "isolated", isolatedChecks);
    await tx`
      update shorts_mvp.editor_releases
      set status='canary_active',canary_started_at=coalesce(canary_started_at,now())
      where id=${releaseId}
    `;
    await tx`
      update shorts_mvp.editor_release_state
      set candidate_release_id=${releaseId},canary_enabled=true,
        updated_by_user_id=${admin.id}
      where singleton=true
    `;
    await recordAudit(
      tx,
      admin.id,
      "editor_release.canary_started",
      releaseId,
      {
        gitSha: release.gitSha,
        workerImageDigest: release.workerImageDigest,
      },
    );
  });
  revalidatePath(adminPath);
}

export async function pauseEditorReleaseCanary() {
  const admin = await requireAdminUser();
  await getDb().begin(async (tx) => {
    const states = await tx`
      select candidate_release_id,canary_enabled
      from shorts_mvp.editor_release_state
      where singleton=true
      for update
    `;
    const state = states[0];
    if (!state?.candidateReleaseId || !state.canaryEnabled) return;
    await tx`
      update shorts_mvp.editor_release_state
      set canary_enabled=false,updated_by_user_id=${admin.id}
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
      {},
    );
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
      select candidate_release_id,canary_enabled
      from shorts_mvp.editor_release_state
      where singleton=true
      for update
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
    const states = await tx`
      select stable_release_id,candidate_release_id,canary_enabled
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
      select id,status,git_sha,worker_image_digest
      from shorts_mvp.editor_releases
      where id=${releaseId}
      for update
    `;
    const release = releases[0];
    if (!release || release.status !== "canary_active") {
      throw new HttpError(409, "카나리 실행 상태가 올바르지 않습니다.");
    }
    await assertChecksPassed(tx, releaseId, "isolated", isolatedChecks);
    await assertChecksPassed(
      tx,
      releaseId,
      "production_canary",
      productionCanaryChecks,
    );
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
      throw new HttpError(409, "카나리 렌더링이 끝난 뒤 승격해 주세요.");
    }
    if (Number(requestCounts[0]?.failed || 0) > 0) {
      throw new HttpError(409, "실패한 카나리 렌더링이 있어 승격할 수 없습니다.");
    }
    if (Number(requestCounts[0]?.succeeded || 0) === 0) {
      throw new HttpError(
        409,
        "성공한 운영 카나리 렌더링이 한 건 이상 필요합니다.",
      );
    }
    await tx`
      update shorts_mvp.editor_releases
      set status='approved',approved_by_user_id=${admin.id},
        approved_at=now()
      where id=${releaseId}
    `;
    await tx`
      update shorts_mvp.editor_release_state
      set previous_stable_release_id=stable_release_id,
        stable_release_id=${releaseId},
        candidate_release_id=null,
        public_enabled=true,canary_enabled=false,
        updated_by_user_id=${admin.id}
      where singleton=true
    `;
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
        rolloutPercent: 100,
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

export async function rollbackEditorRelease(modeValue: "previous" | "legacy") {
  const mode = z.enum(["previous", "legacy"]).parse(modeValue);
  const admin = await requireAdminUser();
  await getDb().begin(async (tx) => {
    const states = await tx`
      select stable_release_id,previous_stable_release_id,candidate_release_id,
        public_enabled,canary_enabled
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
        ${SUBTITLE_TEMPLATES_PUBLIC_FLAG_KEY}
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
      },
    );
  });
  revalidatePath(adminPath);
}
