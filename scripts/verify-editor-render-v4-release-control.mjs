#!/usr/bin/env node

import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import postgres from "../web/node_modules/postgres/src/index.js";
import {
  requireProductionDatabaseUrl,
} from "./production-database-identity.mjs";
import { assertProjectSuccessorLease } from "./verify-editor-render-v4-release-control-successor.mjs";

const EXPECTED_COLUMNS = Object.freeze({
  editor_releases: [
    "render_spec_version",
    "caption_render_spec_version",
    "font_manifest_sha256",
  ],
  editor_release_state: [
    "render_v4_internal_enabled",
    "render_v4_rollout_percent",
    "render_v4_kill_switch",
    "render_v4_infra_lease_id",
    "render_v4_infra_lease_owner",
    "render_v4_infra_lease_expires_at",
  ],
  video_jobs: [
    "initial_render_spec_version",
    "initial_caption_render_spec_version",
  ],
  generated_shorts: ["initial_render_spec"],
  admin_audit_logs: ["render_v4_event_sequence"],
});

const EXPECTED_COLUMN_CONTRACTS = Object.freeze({
  "editor_releases.render_spec_version": ["smallint", "YES", null],
  "editor_releases.caption_render_spec_version": ["smallint", "YES", null],
  "editor_releases.font_manifest_sha256": ["text", "YES", null],
  "editor_release_state.render_v4_internal_enabled": ["boolean", "NO", "false"],
  "editor_release_state.render_v4_rollout_percent": ["smallint", "NO", "0"],
  "editor_release_state.render_v4_kill_switch": ["boolean", "NO", "true"],
  "editor_release_state.render_v4_infra_lease_id": ["uuid", "YES", null],
  "editor_release_state.render_v4_infra_lease_owner": ["text", "YES", null],
  "editor_release_state.render_v4_infra_lease_expires_at": [
    "timestamp with time zone", "YES", null,
  ],
  "video_jobs.initial_render_spec_version": ["smallint", "YES", null],
  "video_jobs.initial_caption_render_spec_version": ["smallint", "YES", null],
  "generated_shorts.initial_render_spec": ["jsonb", "YES", null],
  "admin_audit_logs.render_v4_event_sequence": ["bigint", "YES", null],
});

const EXPECTED_CONSTRAINTS = Object.freeze({
  editor_releases_render_v4_capabilities_check: {
    tableName: "shorts_mvp.editor_releases",
    requiredFragments: [
      "render_spec_version IS NULL",
      "caption_render_spec_version IS NULL",
      "font_manifest_sha256 IS NULL",
      "document_version <= 3",
      "render_spec_version = 4",
      "caption_render_spec_version = 4",
      "document_version = 3",
    ],
  },
  editor_release_state_render_v4_rollout_check: {
    tableName: "shorts_mvp.editor_release_state",
    requiredFragments: ["render_v4_rollout_percent", "0", "5", "25", "100"],
  },
  editor_release_state_render_v4_infra_lease_check: {
    tableName: "shorts_mvp.editor_release_state",
    requiredFragments: [
      "render_v4_infra_lease_id IS NULL",
      "render_v4_infra_lease_owner IS NULL",
      "render_v4_infra_lease_expires_at IS NULL",
      "stage-b:",
      "bootstrap",
      "rotation",
      "lockdown",
      "0-9a-f",
      "40",
    ],
  },
  video_jobs_initial_render_spec_versions_check: {
    tableName: "shorts_mvp.video_jobs",
    requiredFragments: [
      "initial_render_spec_version IS NULL",
      "initial_caption_render_spec_version IS NULL",
      "initial_render_spec_version = 4",
      "initial_caption_render_spec_version = 4",
    ],
  },
  generated_shorts_initial_render_spec_object_check: {
    tableName: "shorts_mvp.generated_shorts",
    requiredFragments: ["initial_render_spec IS NULL", "jsonb_typeof", "object"],
  },
});

const PROJECT_TARGET_COLUMNS = Object.freeze({
  release_id: { dataType: "uuid", nullable: false, defaultValue: null },
  target_key: { dataType: "text", nullable: false, defaultValue: null },
  batch_target_release_id: { dataType: "text", nullable: false, defaultValue: null },
  worker_source_git_sha: { dataType: "text", nullable: false, defaultValue: null },
  worker_image_digest: { dataType: "text", nullable: false, defaultValue: null },
  job_definition_arn: { dataType: "text", nullable: false, defaultValue: null },
  job_queue_arn: { dataType: "text", nullable: false, defaultValue: null },
  created_at: {
    dataType: "timestamp with time zone",
    nullable: false,
    defaultValue: "now()",
  },
});

const PROJECT_TARGET_CONSTRAINTS = Object.freeze({
  editor_release_project_targets_pkey: {
    type: "p",
    pattern: /^PRIMARY KEY \(release_id, target_key\)$/,
  },
  editor_release_project_targets_release_id_fkey: {
    type: "f",
    pattern: /^FOREIGN KEY \(release_id\) REFERENCES shorts_mvp\.editor_releases\(id\) ON DELETE CASCADE$/,
  },
  editor_release_project_targets_job_definition_arn_key: {
    type: "u",
    pattern: /^UNIQUE \(job_definition_arn\)$/,
  },
  editor_release_project_targets_target_key_check: {
    type: "c",
    requiredFragments: [
      "legacy_project",
      "source_range",
      "elevenlabs_transcription",
      "subtitle_templates",
      "unified_template_subtitles",
    ],
  },
  editor_release_project_targets_batch_target_release_id_check: {
    type: "c",
    requiredFragments: ["batch_target_release_id", "a-z0-9._-", "2,127"],
  },
  editor_release_project_targets_worker_source_git_sha_check: {
    type: "c",
    requiredFragments: ["worker_source_git_sha", "0-9a-f", "40"],
  },
  editor_release_project_targets_worker_image_digest_check: {
    type: "c",
    requiredFragments: ["worker_image_digest", "sha256:", "0-9a-f", "64"],
  },
  editor_release_project_targets_job_definition_arn_check: {
    type: "c",
    requiredFragments: [
      "job_definition_arn",
      "arn:aws:batch:",
      "job-definition/",
      "1-9",
    ],
  },
  editor_release_project_targets_job_queue_arn_check: {
    type: "c",
    requiredFragments: ["job_queue_arn", "arn:aws:batch:", "job-queue/"],
  },
});

const migrationPath = path.resolve(
  import.meta.dirname,
  "../supabase/migrations/202608260007_editor_render_spec_v4_release_control.sql",
);

export function normalizeDatabaseDefinition(value) {
  return String(value || "").trim().replace(/\s+/gu, " ");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function migrationFunctionBody(functionName) {
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const candidate of [
    path.resolve(import.meta.dirname, "../supabase/migrations/202609020001_project_successor_admin_dual_admission.sql"),
    path.resolve(import.meta.dirname, "../supabase/migrations/202608310003_project_target_successor.sql"),
    migrationPath,
  ]) {
    const migration = fs.readFileSync(candidate, "utf8");
    const match = new RegExp(
      `create or replace function shorts_mvp\\.${escaped}\\([\\s\\S]*?\\nas \\$\\$\\n([\\s\\S]*?)\\n\\$\\$;`,
      "i",
    ).exec(migration);
    if (match) return match[1];
  }
  throw new Error(`migration에서 함수 본문을 찾을 수 없습니다: ${functionName}`);
}

const EXPECTED_FUNCTION_BODY_SHA256 = Object.freeze({
  protectEditorReleaseIdentity: sha256(normalizeDatabaseDefinition(
    migrationFunctionBody("protect_editor_release_identity"),
  )),
  protectEditorReleaseProjectTarget: sha256(normalizeDatabaseDefinition(
    migrationFunctionBody("protect_editor_release_project_target"),
  )),
  resolveInitialRenderV4Release: sha256(normalizeDatabaseDefinition(
    migrationFunctionBody("resolve_initial_render_v4_release"),
  )),
});

export function validateEditorRenderV4ReleaseControlSnapshot(
  snapshot,
  { requireStopped = false } = {},
) {
  const columns = new Set((snapshot?.columns || []).map((row) => (
    `${row.tableName}.${row.columnName}`
  )));
  for (const [tableName, names] of Object.entries(EXPECTED_COLUMNS)) {
    for (const columnName of names) {
      if (!columns.has(`${tableName}.${columnName}`)) {
        throw new Error(
          `운영 DB에 Stage B 필수 열이 없습니다: shorts_mvp.${tableName}.${columnName}`,
        );
      }
      const actual = (snapshot?.columns || []).find((row) => (
        row.tableName === tableName && row.columnName === columnName
      ));
      const expected = EXPECTED_COLUMN_CONTRACTS[`${tableName}.${columnName}`];
      if (
        !expected
      || actual?.dataType !== expected[0]
      || actual?.isNullable !== expected[1]
      || (actual?.columnDefault || null) !== expected[2]
      ) {
        throw new Error(
          `운영 DB의 Stage B 열 계약이 다릅니다: shorts_mvp.${tableName}.${columnName}`,
        );
      }
    }
  }

  if (snapshot?.projectTargetsTable !== "shorts_mvp.editor_release_project_targets") {
    throw new Error("운영 DB에 editor_release_project_targets가 없습니다.");
  }
  const targetColumns = snapshot?.projectTargetColumns || [];
  if (targetColumns.length !== Object.keys(PROJECT_TARGET_COLUMNS).length) {
    throw new Error("editor_release_project_targets의 열 개수가 exact contract와 다릅니다.");
  }
  const targetColumnMap = new Map(targetColumns.map((row) => [row.columnName, row]));
  for (const [columnName, expected] of Object.entries(PROJECT_TARGET_COLUMNS)) {
    const actual = targetColumnMap.get(columnName);
    if (
      !actual
      || actual.dataType !== expected.dataType
      || (actual.isNullable === "YES") !== expected.nullable
      || (actual.columnDefault || null) !== expected.defaultValue
    ) {
      throw new Error(
        `editor_release_project_targets.${columnName} 열 계약이 다릅니다.`,
      );
    }
  }
  if (
    snapshot?.projectTargetSecurity?.rowLevelSecurity !== true
    || snapshot?.projectTargetSecurity?.forceRowLevelSecurity !== false
  ) {
    throw new Error("editor_release_project_targets RLS 계약이 다릅니다.");
  }

  const targetConstraints = snapshot?.projectTargetConstraints || [];
  if (targetConstraints.length !== Object.keys(PROJECT_TARGET_CONSTRAINTS).length) {
    throw new Error("editor_release_project_targets 제약 개수가 exact contract와 다릅니다.");
  }
  const targetConstraintMap = new Map(targetConstraints.map((row) => [
    row.constraintName,
    row,
  ]));
  for (const [constraintName, expected] of Object.entries(
    PROJECT_TARGET_CONSTRAINTS,
  )) {
    const actual = targetConstraintMap.get(constraintName);
    const definition = normalizeDatabaseDefinition(actual?.definition);
    if (
      !actual
      || actual.constraintType !== expected.type
      || actual.validated !== true
      || (expected.pattern && !expected.pattern.test(definition))
      || (expected.requiredFragments || []).some((fragment) => (
        !definition.includes(fragment)
      ))
    ) {
      throw new Error(
        `editor_release_project_targets 제약 계약이 다릅니다: ${constraintName}`,
      );
    }
  }

  const triggerDefinition = normalizeDatabaseDefinition(
    snapshot?.protectTargetTrigger?.definition,
  );
  if (
    snapshot?.protectTargetTrigger?.enabled !== "O"
    || snapshot?.protectTargetTrigger?.type !== 27
    || !/^CREATE TRIGGER editor_release_project_targets_protect_identity BEFORE (?:DELETE OR UPDATE|UPDATE OR DELETE) ON shorts_mvp\.editor_release_project_targets FOR EACH ROW EXECUTE FUNCTION shorts_mvp\.protect_editor_release_project_target\(\)$/.test(
      triggerDefinition,
    )
  ) {
    throw new Error("운영 DB의 immutable project target trigger 계약이 다릅니다.");
  }

  const protectFunction = snapshot?.protectTargetFunction || {};
  if (
    protectFunction.signature !== "shorts_mvp.protect_editor_release_project_target()"
    || protectFunction.language !== "plpgsql"
    || protectFunction.returnType !== "trigger"
    || protectFunction.securityDefiner !== false
    || protectFunction.volatility !== "v"
    || protectFunction.searchPath !== "shorts_mvp, pg_temp"
    || sha256(normalizeDatabaseDefinition(protectFunction.source))
      !== EXPECTED_FUNCTION_BODY_SHA256.protectEditorReleaseProjectTarget
  ) {
    throw new Error("운영 DB의 immutable project target 보호 함수가 exact contract와 다릅니다.");
  }

  const releaseIdentityTriggerDefinition = normalizeDatabaseDefinition(
    snapshot?.protectReleaseIdentityTrigger?.definition,
  );
  if (
    snapshot?.protectReleaseIdentityTrigger?.enabled !== "O"
    || snapshot?.protectReleaseIdentityTrigger?.type !== 19
    || !/^CREATE TRIGGER editor_releases_protect_identity BEFORE UPDATE ON shorts_mvp\.editor_releases FOR EACH ROW EXECUTE FUNCTION shorts_mvp\.protect_editor_release_identity\(\)$/.test(
      releaseIdentityTriggerDefinition,
    )
  ) {
    throw new Error("운영 DB의 immutable editor release identity trigger 계약이 다릅니다.");
  }

  const releaseIdentityFunction = snapshot?.protectReleaseIdentityFunction || {};
  if (
    releaseIdentityFunction.signature !== "shorts_mvp.protect_editor_release_identity()"
    || releaseIdentityFunction.language !== "plpgsql"
    || releaseIdentityFunction.returnType !== "trigger"
    || releaseIdentityFunction.securityDefiner !== false
    || releaseIdentityFunction.volatility !== "v"
    || releaseIdentityFunction.searchPath !== "shorts_mvp, pg_temp"
    || sha256(normalizeDatabaseDefinition(releaseIdentityFunction.source))
      !== EXPECTED_FUNCTION_BODY_SHA256.protectEditorReleaseIdentity
  ) {
    throw new Error("운영 DB의 immutable editor release identity 보호 함수가 exact contract와 다릅니다.");
  }

  const resolver = snapshot?.resolverFunction || {};
  if (
    resolver.signature !== "shorts_mvp.resolve_initial_render_v4_release(uuid,text,text,text,text,text,text)"
    || resolver.language !== "plpgsql"
    || resolver.returnType !== "record"
    || resolver.securityDefiner !== true
    || resolver.volatility !== "v"
    || resolver.searchPath !== "shorts_mvp, pg_temp"
    || sha256(normalizeDatabaseDefinition(resolver.source))
      !== EXPECTED_FUNCTION_BODY_SHA256.resolveInitialRenderV4Release
  ) {
    throw new Error("운영 DB의 v4 release resolver 함수가 exact contract와 다릅니다.");
  }
  if (
    snapshot?.auditTransitionSequence?.sequenceName
      !== "shorts_mvp.editor_render_v4_audit_event_sequence"
    || snapshot?.auditTransitionSequence?.dataType !== "bigint"
    || String(snapshot?.auditTransitionSequence?.startValue) !== "1"
    || String(snapshot?.auditTransitionSequence?.minimumValue) !== "1"
    || String(snapshot?.auditTransitionSequence?.maximumValue)
      !== "9223372036854775807"
    || String(snapshot?.auditTransitionSequence?.incrementBy) !== "1"
    || String(snapshot?.auditTransitionSequence?.cacheSize) !== "1"
    || snapshot?.auditTransitionSequence?.cycles !== false
    || snapshot?.auditTransitionSequence?.serviceRoleUsage !== true
    || snapshot?.auditTransitionSequence?.serviceRoleSelect !== true
    || snapshot?.auditTransitionSequence?.serviceRoleUpdate !== false
    || snapshot?.auditTransitionSequence?.anonUsage !== false
    || snapshot?.auditTransitionSequence?.anonSelect !== false
    || snapshot?.auditTransitionSequence?.anonUpdate !== false
    || snapshot?.auditTransitionSequence?.authenticatedUsage !== false
    || snapshot?.auditTransitionSequence?.authenticatedSelect !== false
    || snapshot?.auditTransitionSequence?.authenticatedUpdate !== false
    || snapshot?.auditTransitionSequence?.publicUsage !== false
    || snapshot?.auditTransitionSequence?.publicSelect !== false
    || snapshot?.auditTransitionSequence?.publicUpdate !== false
    || Number(snapshot?.auditTransitionSequence?.unexpectedGrantCount) !== 0
  ) {
    throw new Error("운영 DB의 전용 v4 audit sequence 계약이 다릅니다.");
  }

  if ((snapshot?.constraints || []).length !== Object.keys(EXPECTED_CONSTRAINTS).length) {
    throw new Error("운영 DB의 Stage B 제약 개수가 exact contract와 다릅니다.");
  }
  const constraints = new Map((snapshot?.constraints || []).map((row) => [
    row.constraintName,
    row,
  ]));
  for (const [constraintName, expected] of Object.entries(EXPECTED_CONSTRAINTS)) {
    const actual = constraints.get(constraintName);
    const definition = normalizeDatabaseDefinition(actual?.definition);
    if (
      !actual
      || actual.tableName !== expected.tableName
      || actual.constraintType !== "c"
      || actual.validated !== true
      || expected.requiredFragments.some((fragment) => !definition.includes(fragment))
    ) {
      throw new Error(`운영 DB의 Stage B 제약이 exact contract와 다릅니다: ${constraintName}`);
    }
  }

  const privileges = snapshot?.projectTargetPrivileges || {};
  if (
    privileges.serviceRoleSelect !== true
    || privileges.serviceRoleInsert !== true
    || privileges.serviceRoleUpdate !== false
    || privileges.serviceRoleDelete !== false
    || privileges.anonAny !== false
    || privileges.authenticatedAny !== false
  ) {
    throw new Error("editor_release_project_targets의 role 권한이 불변 계약과 다릅니다.");
  }
  for (const [label, functionPrivileges] of [
    ["release identity protector", snapshot?.protectReleaseIdentityFunction?.privileges],
    ["target protector", snapshot?.protectTargetFunction?.privileges],
    ["v4 resolver", snapshot?.resolverFunction?.privileges],
  ]) {
    if (
      functionPrivileges?.serviceRoleExecute !== true
      || functionPrivileges?.anonExecute !== false
      || functionPrivileges?.authenticatedExecute !== false
      || functionPrivileges?.publicExecute !== false
      || Number(functionPrivileges?.unexpectedExecuteGrantCount) !== 0
    ) {
      throw new Error(`${label} 함수 ACL이 exact contract와 다릅니다.`);
    }
  }

  if (!snapshot?.releaseState || snapshot.releaseState.singleton !== true) {
    throw new Error("운영 editor_release_state singleton을 확인할 수 없습니다.");
  }
  if (requireStopped && (
    snapshot.releaseState.renderV4KillSwitch !== true
    || snapshot.releaseState.renderV4InternalEnabled !== false
    || Number(snapshot.releaseState.renderV4RolloutPercent) !== 0
  )) {
    throw new Error(
      "Stage B bootstrap/rotation 전에는 v4 kill switch=true, internal=false, rollout=0이어야 합니다.",
    );
  }
  return snapshot;
}

const LEASE_OWNER = /^stage-b:(bootstrap|rotation|lockdown):[0-9a-f]{40}$/;
const LEASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_LEASE_TTL_SECONDS = 2 * 60 * 60;

function validateLeaseIdentity(ownerValue, leaseIdValue) {
  const owner = String(ownerValue || "").trim();
  const leaseId = String(leaseIdValue || "").trim().toLowerCase();
  const ownerMatch = LEASE_OWNER.exec(owner);
  if (!ownerMatch || !LEASE_ID.test(leaseId)) {
    throw new Error("Stage B infrastructure lease identity가 exact contract와 다릅니다.");
  }
  return { owner, leaseId, phase: ownerMatch[1] };
}

export function editorRenderV4InfrastructureLeaseRequiresStopped(ownerValue) {
  const owner = String(ownerValue || "").trim();
  const ownerMatch = LEASE_OWNER.exec(owner);
  if (!ownerMatch) {
    throw new Error("Stage B infrastructure lease owner가 exact contract와 다릅니다.");
  }
  return ownerMatch[1] !== "lockdown";
}

function databaseOptions({ readOnly = true } = {}) {
  return {
    max: 1,
    prepare: false,
    connect_timeout: 15,
    idle_timeout: 5,
    connection: {
      application_name: "easycut-editor-render-v4-schema-verifier",
      default_transaction_read_only: readOnly,
      statement_timeout: 15_000,
    },
    transform: postgres.camel,
  };
}

export async function acquireEditorRenderV4InfrastructureLease({
  environment = process.env,
  owner: ownerValue,
  leaseId: leaseIdValue,
  ttlSeconds = 90,
  successor = null,
} = {}) {
  const { owner, leaseId, phase } = validateLeaseIdentity(ownerValue, leaseIdValue);
  if (successor && (phase !== "rotation" || owner !== `stage-b:rotation:${successor.head}`)) {
    throw new Error("successor lease는 동일 exact rotation HEAD만 허용합니다.");
  }
  if (
    !Number.isInteger(ttlSeconds)
    || ttlSeconds < 30
    || ttlSeconds > MAX_LEASE_TTL_SECONDS
  ) {
    throw new Error("Stage B infrastructure lease TTL은 30~7200초 정수여야 합니다.");
  }
  const databaseUrl = requireProductionDatabaseUrl(environment);
  const sql = postgres(databaseUrl, databaseOptions({ readOnly: false }));
  try {
    return await sql.begin(async (tx) => {
      const states = await tx`
        select render_v4_internal_enabled,render_v4_rollout_percent,
          render_v4_kill_switch,render_v4_infra_lease_id,
          render_v4_infra_lease_owner,render_v4_infra_lease_expires_at,
          render_v4_target_successor,
          (render_v4_infra_lease_id is not null
            and render_v4_infra_lease_expires_at > clock_timestamp())
            as lease_active
        from shorts_mvp.editor_release_state
        where singleton=true
        for update
      `;
      const state = states[0];
      if (!state) throw new Error("운영 editor_release_state singleton이 없습니다.");
      if (successor) {
        await assertProjectSuccessorLease(tx, successor, { requireDrained: true });
      } else if (state.renderV4TargetSuccessor && state.renderV4TargetSuccessor.phase !== "active") {
        throw new Error("영구 successor fence가 있어 다른 infrastructure lease를 획득할 수 없습니다.");
      }
      if (
        !successor && editorRenderV4InfrastructureLeaseRequiresStopped(owner)
        && (
        state.renderV4KillSwitch !== true
        || state.renderV4InternalEnabled !== false
        || Number(state.renderV4RolloutPercent) !== 0
        )
      ) {
        throw new Error("Stage B AWS 실행 전 v4가 완전히 중단되어야 합니다.");
      }
      if (state.leaseActive === true) {
        throw new Error(
          `다른 Stage B infrastructure lease가 활성 상태입니다: ${state.renderV4InfraLeaseOwner || "unknown"}`,
        );
      }
      const updated = await tx`
        update shorts_mvp.editor_release_state
        set render_v4_infra_lease_id=${leaseId}::uuid,
          render_v4_infra_lease_owner=${owner},
          render_v4_infra_lease_expires_at=clock_timestamp()
            + ${ttlSeconds} * interval '1 second'
        where singleton=true
        returning render_v4_infra_lease_expires_at
      `;
      if (updated.length !== 1) throw new Error("Stage B lease 획득에 실패했습니다.");
      return updated[0];
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function renewEditorRenderV4InfrastructureLease({
  environment = process.env,
  owner: ownerValue,
  leaseId: leaseIdValue,
  ttlSeconds = 90,
  successor = null,
} = {}) {
  const { owner, leaseId, phase } = validateLeaseIdentity(ownerValue, leaseIdValue);
  if (successor && (phase !== "rotation" || owner !== `stage-b:rotation:${successor.head}`)) {
    throw new Error("successor lease는 동일 exact rotation HEAD만 허용합니다.");
  }
  if (
    !Number.isInteger(ttlSeconds)
    || ttlSeconds < 30
    || ttlSeconds > MAX_LEASE_TTL_SECONDS
  ) {
    throw new Error("Stage B infrastructure lease TTL은 30~7200초 정수여야 합니다.");
  }
  const requiresStopped = editorRenderV4InfrastructureLeaseRequiresStopped(owner);
  const databaseUrl = requireProductionDatabaseUrl(environment);
  const sql = postgres(databaseUrl, databaseOptions({ readOnly: false }));
  try {
    if (successor) {
      return await sql.begin(async (tx) => {
        await tx`select singleton from shorts_mvp.editor_release_state where singleton for update`;
        await assertProjectSuccessorLease(tx, successor);
        const rows = await tx`
          update shorts_mvp.editor_release_state
          set render_v4_infra_lease_expires_at=clock_timestamp()+${ttlSeconds}*interval '1 second'
          where singleton and render_v4_infra_lease_id=${leaseId}::uuid
            and render_v4_infra_lease_owner=${owner}
            and render_v4_infra_lease_expires_at>clock_timestamp()
          returning render_v4_infra_lease_expires_at
        `;
        if (rows.length !== 1) throw new Error("successor infrastructure lease가 만료·변경됐습니다. 영구 fence는 유지합니다.");
        return rows[0];
      });
    }
    const updated = await sql`
      update shorts_mvp.editor_release_state
      set render_v4_infra_lease_expires_at=clock_timestamp()
        + ${ttlSeconds} * interval '1 second'
      where singleton=true
        and render_v4_infra_lease_id=${leaseId}::uuid
        and render_v4_infra_lease_owner=${owner}
        and render_v4_infra_lease_expires_at > clock_timestamp()
        and (render_v4_target_successor is null or render_v4_target_successor->>'phase'='active')
        and (
          ${!requiresStopped}
          or (
            render_v4_kill_switch=true
            and render_v4_internal_enabled=false
            and render_v4_rollout_percent=0
          )
        )
      returning render_v4_infra_lease_expires_at
    `;
    if (updated.length !== 1) {
      throw new Error("Stage B infrastructure lease가 만료·변경되었거나 v4가 중단 상태가 아닙니다.");
    }
    return updated[0];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function releaseEditorRenderV4InfrastructureLease({
  environment = process.env,
  owner: ownerValue,
  leaseId: leaseIdValue,
} = {}) {
  const { owner, leaseId } = validateLeaseIdentity(ownerValue, leaseIdValue);
  const databaseUrl = requireProductionDatabaseUrl(environment);
  const sql = postgres(databaseUrl, databaseOptions({ readOnly: false }));
  try {
    const released = await sql`
      update shorts_mvp.editor_release_state
      set render_v4_infra_lease_id=null,
        render_v4_infra_lease_owner=null,
        render_v4_infra_lease_expires_at=null
      where singleton=true
        and render_v4_infra_lease_id=${leaseId}::uuid
        and render_v4_infra_lease_owner=${owner}
      returning singleton
    `;
    if (released.length !== 1) {
      throw new Error("Stage B infrastructure lease owner가 달라 해제하지 않았습니다.");
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function readEditorRenderV4ReleaseControlSnapshot(sql) {
  // The verifier intentionally uses a single read-only connection. Run the
  // catalog reads in order so an expected pre-migration regclass failure is
  // reported immediately instead of leaving sibling queries queued behind a
  // rejected query on the same connection.
  const columns = await sql`
      select table_name, column_name, data_type, is_nullable, column_default
        ,is_identity,identity_generation
      from information_schema.columns
      where table_schema='shorts_mvp'
        and table_name in (
          'editor_releases','editor_release_state','video_jobs','generated_shorts',
          'admin_audit_logs'
        )
    `;
  const constraints = await sql`
      select
        conname as constraint_name,
        conrelid::regclass::text as table_name,
        contype::text as constraint_type,
        convalidated as validated,
        pg_get_constraintdef(oid,true) as definition
      from pg_constraint
      where connamespace='shorts_mvp'::regnamespace
        and conname in (
          'editor_releases_render_v4_capabilities_check',
          'editor_release_state_render_v4_rollout_check',
          'editor_release_state_render_v4_infra_lease_check',
          'video_jobs_initial_render_spec_versions_check',
          'generated_shorts_initial_render_spec_object_check'
        )
    `;
  const projectTargetColumns = await sql`
      select
        column_name,
        data_type,
        is_nullable,
        column_default
      from information_schema.columns
      where table_schema='shorts_mvp'
        and table_name='editor_release_project_targets'
      order by ordinal_position
    `;
  const projectTargetConstraints = await sql`
      select
        conname as constraint_name,
        contype::text as constraint_type,
        convalidated as validated,
        pg_get_constraintdef(oid,true) as definition
      from pg_constraint
      where conrelid='shorts_mvp.editor_release_project_targets'::regclass
      order by conname
    `;
  const projectTargetObjects = await sql`
      select
        target.oid::regclass::text as project_targets_table,
        target.relrowsecurity as row_level_security,
        target.relforcerowsecurity as force_row_level_security,
        has_table_privilege(
          'service_role','shorts_mvp.editor_release_project_targets','SELECT'
        ) as service_role_select,
        has_table_privilege(
          'service_role','shorts_mvp.editor_release_project_targets','INSERT'
        ) as service_role_insert,
        has_table_privilege(
          'service_role','shorts_mvp.editor_release_project_targets','UPDATE'
        ) as service_role_update,
        has_table_privilege(
          'service_role','shorts_mvp.editor_release_project_targets','DELETE'
        ) as service_role_delete,
        (
          has_table_privilege('anon',target.oid,'SELECT')
          or has_table_privilege('anon',target.oid,'INSERT')
          or has_table_privilege('anon',target.oid,'UPDATE')
          or has_table_privilege('anon',target.oid,'DELETE')
        ) as anon_any,
        (
          has_table_privilege('authenticated',target.oid,'SELECT')
          or has_table_privilege('authenticated',target.oid,'INSERT')
          or has_table_privilege('authenticated',target.oid,'UPDATE')
          or has_table_privilege('authenticated',target.oid,'DELETE')
        ) as authenticated_any
      from pg_class target
      where target.oid='shorts_mvp.editor_release_project_targets'::regclass
    `;
  const protectTriggers = await sql`
      select
        tgname as trigger_name,
        tgenabled::text as enabled,
        tgtype::integer as type,
        pg_get_triggerdef(oid,true) as definition
      from pg_trigger
      where (
        (
          tgrelid='shorts_mvp.editor_release_project_targets'::regclass
          and tgname='editor_release_project_targets_protect_identity'
        ) or (
          tgrelid='shorts_mvp.editor_releases'::regclass
          and tgname='editor_releases_protect_identity'
        )
      )
        and not tgisinternal
    `;
  const functions = await sql`
      select
        p.oid::regprocedure::text as signature,
        p.proname as function_name,
        language.lanname as language,
        p.prorettype::regtype::text as return_type,
        p.prosecdef as security_definer,
        p.provolatile::text as volatility,
        coalesce((
          select regexp_replace(setting,'^search_path=','')
          from unnest(coalesce(p.proconfig,array[]::text[])) setting
          where setting like 'search_path=%'
        ), '') as search_path,
        p.prosrc as source,
        has_function_privilege('service_role',p.oid,'EXECUTE')
          as service_role_execute,
        has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
        has_function_privilege('authenticated',p.oid,'EXECUTE')
          as authenticated_execute,
        exists (
          select 1
          from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
          where acl.grantee=0 and acl.privilege_type='EXECUTE'
        ) as public_execute,
        (
          select count(*)::integer
          from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
          where acl.grantee<>p.proowner
            and (
              acl.grantee<>(
                select oid from pg_roles where rolname='service_role'
              )
              or acl.privilege_type<>'EXECUTE'
              or acl.is_grantable
            )
        ) as unexpected_execute_grant_count
      from pg_proc p
      join pg_language language on language.oid=p.prolang
      where p.oid in (
        'shorts_mvp.protect_editor_release_identity()'::regprocedure,
        'shorts_mvp.protect_editor_release_project_target()'::regprocedure,
        'shorts_mvp.resolve_initial_render_v4_release(uuid,text,text,text,text,text,text)'::regprocedure
      )
    `;
  const releaseStates = await sql`
      select
        singleton,
        render_v4_internal_enabled,
        render_v4_rollout_percent,
        render_v4_kill_switch,
        render_v4_infra_lease_id,
        render_v4_infra_lease_owner,
        render_v4_infra_lease_expires_at
      from shorts_mvp.editor_release_state
      where singleton
    `;
  const auditTransitionSequences = await sql`
      select seq.oid::regclass::text as sequence_name,
        settings.seqtypid::regtype::text as data_type,
        settings.seqstart as start_value,
        settings.seqmin as minimum_value,
        settings.seqmax as maximum_value,
        settings.seqincrement as increment_by,
        settings.seqcache as cache_size,
        settings.seqcycle as cycles,
        has_sequence_privilege(
          'service_role',seq.oid,'USAGE'
        ) as service_role_usage,
        has_sequence_privilege(
          'service_role',seq.oid,'SELECT'
        ) as service_role_select,
        has_sequence_privilege(
          'service_role',seq.oid,'UPDATE'
        ) as service_role_update,
        has_sequence_privilege('anon',seq.oid,'USAGE') as anon_usage,
        has_sequence_privilege('anon',seq.oid,'SELECT') as anon_select,
        has_sequence_privilege('anon',seq.oid,'UPDATE') as anon_update,
        has_sequence_privilege(
          'authenticated',seq.oid,'USAGE'
        ) as authenticated_usage,
        has_sequence_privilege(
          'authenticated',seq.oid,'SELECT'
        ) as authenticated_select,
        has_sequence_privilege(
          'authenticated',seq.oid,'UPDATE'
        ) as authenticated_update,
        exists (
          select 1
          from aclexplode(coalesce(seq.relacl,acldefault('S',seq.relowner))) acl
          where acl.grantee=0 and acl.privilege_type='USAGE'
        ) as public_usage,
        exists (
          select 1
          from aclexplode(coalesce(seq.relacl,acldefault('S',seq.relowner))) acl
          where acl.grantee=0 and acl.privilege_type='SELECT'
        ) as public_select,
        exists (
          select 1
          from aclexplode(coalesce(seq.relacl,acldefault('S',seq.relowner))) acl
          where acl.grantee=0 and acl.privilege_type='UPDATE'
        ) as public_update,
        (
          select count(*)::integer
          from aclexplode(coalesce(seq.relacl,acldefault('S',seq.relowner))) acl
          where acl.grantee<>seq.relowner
            and (
              acl.grantee<>(
                select oid from pg_roles where rolname='service_role'
              )
              or acl.privilege_type not in ('USAGE','SELECT')
              or acl.is_grantable
            )
        ) as unexpected_grant_count
      from pg_class seq
      join pg_sequence settings on settings.seqrelid=seq.oid
      where seq.oid=
        'shorts_mvp.editor_render_v4_audit_event_sequence'::regclass
        and seq.relkind='S'
    `;
  const object = projectTargetObjects[0] || {};
  const functionMap = new Map(functions.map((entry) => [
    entry.functionName,
    {
      signature: entry.signature,
      language: entry.language,
      returnType: entry.returnType,
      securityDefiner: entry.securityDefiner,
      volatility: entry.volatility,
      searchPath: entry.searchPath,
      source: entry.source,
      privileges: {
        serviceRoleExecute: entry.serviceRoleExecute,
        anonExecute: entry.anonExecute,
        authenticatedExecute: entry.authenticatedExecute,
        publicExecute: entry.publicExecute,
        unexpectedExecuteGrantCount: entry.unexpectedExecuteGrantCount,
      },
    },
  ]));
  return {
    columns,
    constraints,
    projectTargetsTable: object.projectTargetsTable || null,
    projectTargetColumns,
    projectTargetConstraints,
    projectTargetSecurity: {
      rowLevelSecurity: object.rowLevelSecurity,
      forceRowLevelSecurity: object.forceRowLevelSecurity,
    },
    protectReleaseIdentityTrigger: protectTriggers.filter((entry) => (
      entry.triggerName === "editor_releases_protect_identity"
    )).length === 1
      ? protectTriggers.find((entry) => (
        entry.triggerName === "editor_releases_protect_identity"
      ))
      : null,
    protectTargetTrigger: protectTriggers.filter((entry) => (
      entry.triggerName === "editor_release_project_targets_protect_identity"
    )).length === 1
      ? protectTriggers.find((entry) => (
        entry.triggerName === "editor_release_project_targets_protect_identity"
      ))
      : null,
    protectReleaseIdentityFunction: functionMap.get(
      "protect_editor_release_identity",
    ) || null,
    protectTargetFunction: functionMap.get(
      "protect_editor_release_project_target",
    ) || null,
    resolverFunction: functionMap.get("resolve_initial_render_v4_release") || null,
    auditTransitionSequence: auditTransitionSequences.length === 1
      ? auditTransitionSequences[0]
      : null,
    projectTargetPrivileges: {
      serviceRoleSelect: object.serviceRoleSelect,
      serviceRoleInsert: object.serviceRoleInsert,
      serviceRoleUpdate: object.serviceRoleUpdate,
      serviceRoleDelete: object.serviceRoleDelete,
      anonAny: object.anonAny,
      authenticatedAny: object.authenticatedAny,
    },
    releaseState: releaseStates.length === 1 ? releaseStates[0] : null,
  };
}

export async function verifyEditorRenderV4ReleaseControl({
  environment = process.env,
  requireStopped = false,
} = {}) {
  const databaseUrl = requireProductionDatabaseUrl(environment);
  const sql = postgres(databaseUrl, databaseOptions());
  try {
    const snapshot = await readEditorRenderV4ReleaseControlSnapshot(sql);
    return validateEditorRenderV4ReleaseControlSnapshot(snapshot, { requireStopped });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(argv = process.argv.slice(2)) {
  const unexpected = argv.filter((value) => value !== "--require-stopped");
  if (unexpected.length) {
    throw new Error(`알 수 없는 옵션입니다: ${unexpected.join(" ")}`);
  }
  await verifyEditorRenderV4ReleaseControl({
    requireStopped: argv.includes("--require-stopped"),
  });
  process.stdout.write("운영 DB Stage B release-control schema 검증 통과\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
