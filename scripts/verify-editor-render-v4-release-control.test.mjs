import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  editorRenderV4InfrastructureLeaseRequiresStopped,
  migrationFunctionBody,
  readEditorRenderV4ReleaseControlSnapshot,
  validateEditorRenderV4ReleaseControlSnapshot,
} from "./verify-editor-render-v4-release-control.mjs";

function validSnapshot() {
  return {
    columns: [
      ["editor_releases", "render_spec_version", "smallint", "YES", null],
      ["editor_releases", "caption_render_spec_version", "smallint", "YES", null],
      ["editor_releases", "font_manifest_sha256", "text", "YES", null],
      ["editor_release_state", "render_v4_internal_enabled", "boolean", "NO", "false"],
      ["editor_release_state", "render_v4_rollout_percent", "smallint", "NO", "0"],
      ["editor_release_state", "render_v4_kill_switch", "boolean", "NO", "true"],
      ["editor_release_state", "render_v4_infra_lease_id", "uuid", "YES", null],
      ["editor_release_state", "render_v4_infra_lease_owner", "text", "YES", null],
      ["editor_release_state", "render_v4_infra_lease_expires_at", "timestamp with time zone", "YES", null],
      ["video_jobs", "initial_render_spec_version", "smallint", "YES", null],
      ["video_jobs", "initial_caption_render_spec_version", "smallint", "YES", null],
      ["generated_shorts", "initial_render_spec", "jsonb", "YES", null],
      ["admin_audit_logs", "render_v4_event_sequence", "bigint", "YES", null],
    ].map(([
      tableName,
      columnName,
      dataType,
      isNullable,
      columnDefault,
    ]) => ({
      tableName,
      columnName,
      dataType,
      isNullable,
      columnDefault,
      isIdentity: "NO",
      identityGeneration: null,
    })),
    constraints: [
      [
        "editor_releases_render_v4_capabilities_check",
        "shorts_mvp.editor_releases",
        "CHECK render_spec_version IS NULL caption_render_spec_version IS NULL font_manifest_sha256 IS NULL document_version <= 3 render_spec_version = 4 caption_render_spec_version = 4 document_version = 3",
      ],
      [
        "editor_release_state_render_v4_rollout_check",
        "shorts_mvp.editor_release_state",
        "CHECK render_v4_rollout_percent 0 5 25 100",
      ],
      [
        "editor_release_state_render_v4_infra_lease_check",
        "shorts_mvp.editor_release_state",
        "CHECK render_v4_infra_lease_id IS NULL render_v4_infra_lease_owner IS NULL render_v4_infra_lease_expires_at IS NULL stage-b: bootstrap rotation lockdown 0-9a-f 40",
      ],
      [
        "video_jobs_initial_render_spec_versions_check",
        "shorts_mvp.video_jobs",
        "CHECK initial_render_spec_version IS NULL initial_caption_render_spec_version IS NULL initial_render_spec_version = 4 initial_caption_render_spec_version = 4",
      ],
      [
        "generated_shorts_initial_render_spec_object_check",
        "shorts_mvp.generated_shorts",
        "CHECK initial_render_spec IS NULL jsonb_typeof object",
      ],
    ].map(([constraintName, tableName, definition]) => ({
      constraintName,
      tableName,
      constraintType: "c",
      definition,
      validated: true,
    })),
    projectTargetsTable: "shorts_mvp.editor_release_project_targets",
    projectTargetColumns: [
      ["release_id", "uuid", "NO", null],
      ["target_key", "text", "NO", null],
      ["batch_target_release_id", "text", "NO", null],
      ["worker_source_git_sha", "text", "NO", null],
      ["worker_image_digest", "text", "NO", null],
      ["job_definition_arn", "text", "NO", null],
      ["job_queue_arn", "text", "NO", null],
      ["created_at", "timestamp with time zone", "NO", "now()"],
    ].map(([columnName, dataType, isNullable, columnDefault]) => ({
      columnName,
      dataType,
      isNullable,
      columnDefault,
    })),
    projectTargetConstraints: [
      ["editor_release_project_targets_pkey", "p", "PRIMARY KEY (release_id, target_key)"],
      ["editor_release_project_targets_release_id_fkey", "f", "FOREIGN KEY (release_id) REFERENCES shorts_mvp.editor_releases(id) ON DELETE CASCADE"],
      ["editor_release_project_targets_job_definition_arn_key", "u", "UNIQUE (job_definition_arn)"],
      ["editor_release_project_targets_target_key_check", "c", "CHECK target_key legacy_project source_range elevenlabs_transcription subtitle_templates unified_template_subtitles"],
      ["editor_release_project_targets_batch_target_release_id_check", "c", "CHECK batch_target_release_id a-z0-9._- 2,127"],
      ["editor_release_project_targets_worker_source_git_sha_check", "c", "CHECK worker_source_git_sha 0-9a-f 40"],
      ["editor_release_project_targets_worker_image_digest_check", "c", "CHECK worker_image_digest sha256: 0-9a-f 64"],
      ["editor_release_project_targets_job_definition_arn_check", "c", "CHECK job_definition_arn arn:aws:batch: job-definition/ 1-9"],
      ["editor_release_project_targets_job_queue_arn_check", "c", "CHECK job_queue_arn arn:aws:batch: job-queue/"],
    ].map(([constraintName, constraintType, definition]) => ({
      constraintName,
      constraintType,
      definition,
      validated: true,
    })),
    projectTargetSecurity: {
      rowLevelSecurity: true,
      forceRowLevelSecurity: false,
    },
    protectTargetTrigger: {
      enabled: "O",
      type: 27,
      definition: "CREATE TRIGGER editor_release_project_targets_protect_identity BEFORE DELETE OR UPDATE ON shorts_mvp.editor_release_project_targets FOR EACH ROW EXECUTE FUNCTION shorts_mvp.protect_editor_release_project_target()",
    },
    protectReleaseIdentityTrigger: {
      enabled: "O",
      type: 19,
      definition: "CREATE TRIGGER editor_releases_protect_identity BEFORE UPDATE ON shorts_mvp.editor_releases FOR EACH ROW EXECUTE FUNCTION shorts_mvp.protect_editor_release_identity()",
    },
    protectReleaseIdentityFunction: {
      signature: "shorts_mvp.protect_editor_release_identity()",
      language: "plpgsql",
      returnType: "trigger",
      securityDefiner: false,
      volatility: "v",
      searchPath: "shorts_mvp, pg_temp",
      source: migrationFunctionBody("protect_editor_release_identity"),
      privileges: {
        serviceRoleExecute: true,
        anonExecute: false,
        authenticatedExecute: false,
        publicExecute: false,
        unexpectedExecuteGrantCount: 0,
      },
    },
    protectTargetFunction: {
      signature: "shorts_mvp.protect_editor_release_project_target()",
      language: "plpgsql",
      returnType: "trigger",
      securityDefiner: false,
      volatility: "v",
      searchPath: "shorts_mvp, pg_temp",
      source: migrationFunctionBody("protect_editor_release_project_target"),
      privileges: {
        serviceRoleExecute: true,
        anonExecute: false,
        authenticatedExecute: false,
        publicExecute: false,
        unexpectedExecuteGrantCount: 0,
      },
    },
    resolverFunction: {
      signature: "shorts_mvp.resolve_initial_render_v4_release(uuid,text,text,text,text,text,text)",
      language: "plpgsql",
      returnType: "record",
      securityDefiner: true,
      volatility: "v",
      searchPath: "shorts_mvp, pg_temp",
      source: migrationFunctionBody("resolve_initial_render_v4_release"),
      privileges: {
        serviceRoleExecute: true,
        anonExecute: false,
        authenticatedExecute: false,
        publicExecute: false,
        unexpectedExecuteGrantCount: 0,
      },
    },
    auditTransitionSequence: {
      sequenceName: "shorts_mvp.editor_render_v4_audit_event_sequence",
      dataType: "bigint",
      startValue: "1",
      minimumValue: "1",
      maximumValue: "9223372036854775807",
      incrementBy: "1",
      cacheSize: "1",
      cycles: false,
      serviceRoleUsage: true,
      serviceRoleSelect: true,
      serviceRoleUpdate: false,
      anonUsage: false,
      anonSelect: false,
      anonUpdate: false,
      authenticatedUsage: false,
      authenticatedSelect: false,
      authenticatedUpdate: false,
      publicUsage: false,
      publicSelect: false,
      publicUpdate: false,
      unexpectedGrantCount: 0,
    },
    projectTargetPrivileges: {
      serviceRoleSelect: true,
      serviceRoleInsert: true,
      serviceRoleUpdate: false,
      serviceRoleDelete: false,
      anonAny: false,
      authenticatedAny: false,
    },
    releaseState: {
      singleton: true,
      renderV4InternalEnabled: false,
      renderV4RolloutPercent: 0,
      renderV4KillSwitch: true,
    },
  };
}

test("accepts the exact additive Stage B schema while rollout is stopped", () => {
  assert.equal(
    validateEditorRenderV4ReleaseControlSnapshot(validSnapshot(), {
      requireStopped: true,
    }).projectTargetsTable,
    "shorts_mvp.editor_release_project_targets",
  );
});

test("pins the resolver to the runtime editor flag and exact function body", () => {
  assert.match(
    migrationFunctionBody("resolve_initial_render_v4_release"),
    /runtime_feature_flags runtime[\s\S]*flag_key='editor_rendering_v2'[\s\S]*runtime\.enabled/,
  );
  assert.match(
    migrationFunctionBody("resolve_initial_render_v4_release"),
    /render_v4_infra_lease_id is not null[\s\S]*render_v4_infra_lease_expires_at > clock_timestamp\(\)/,
  );
  assert.match(
    migrationFunctionBody("resolve_initial_render_v4_release"),
    /for share of state,runtime/,
  );
  const tampered = validSnapshot();
  tampered.resolverFunction.source = tampered.resolverFunction.source.replace(
    "and runtime.enabled",
    "and not runtime.enabled",
  );
  assert.throws(
    () => validateEditorRenderV4ReleaseControlSnapshot(tampered),
    /resolver 함수가 exact contract와 다릅니다/,
  );
});

test("pins the editor release identity trigger, function, ACL, and all v4 guards", () => {
  const guards = [
    [
      "    or new.render_spec_version\n      is distinct from old.render_spec_version\n",
      "render_spec_version",
    ],
    [
      "    or new.caption_render_spec_version\n      is distinct from old.caption_render_spec_version\n",
      "caption_render_spec_version",
    ],
    [
      "    or new.font_manifest_sha256\n      is distinct from old.font_manifest_sha256\n",
      "font_manifest_sha256",
    ],
  ];
  for (const [guard, label] of guards) {
    const tampered = validSnapshot();
    assert.match(tampered.protectReleaseIdentityFunction.source, new RegExp(label));
    tampered.protectReleaseIdentityFunction.source =
      tampered.protectReleaseIdentityFunction.source.replace(guard, "");
    assert.throws(
      () => validateEditorRenderV4ReleaseControlSnapshot(tampered),
      /editor release identity 보호 함수가 exact contract와 다릅니다/,
      label,
    );
  }

  const wrongTrigger = validSnapshot();
  wrongTrigger.protectReleaseIdentityTrigger.definition =
    wrongTrigger.protectReleaseIdentityTrigger.definition.replace(
      "protect_editor_release_identity",
      "protect_editor_release_project_target",
    );
  assert.throws(
    () => validateEditorRenderV4ReleaseControlSnapshot(wrongTrigger),
    /editor release identity trigger 계약이 다릅니다/,
  );

  const wrongAcl = validSnapshot();
  wrongAcl.protectReleaseIdentityFunction.privileges.publicExecute = true;
  assert.throws(
    () => validateEditorRenderV4ReleaseControlSnapshot(wrongAcl),
    /release identity protector 함수 ACL이 exact contract와 다릅니다/,
  );

  for (const [property, value] of [
    ["signature", "shorts_mvp.protect_editor_release_project_target()"],
    ["language", "sql"],
    ["returnType", "void"],
    ["securityDefiner", true],
    ["volatility", "s"],
    ["searchPath", "public"],
  ]) {
    const tampered = validSnapshot();
    tampered.protectReleaseIdentityFunction[property] = value;
    assert.throws(
      () => validateEditorRenderV4ReleaseControlSnapshot(tampered),
      /editor release identity 보호 함수가 exact contract와 다릅니다/,
      property,
    );
  }

  for (const [property, value] of [
    ["enabled", "D"],
    ["type", 17],
  ]) {
    const tampered = validSnapshot();
    tampered.protectReleaseIdentityTrigger[property] = value;
    assert.throws(
      () => validateEditorRenderV4ReleaseControlSnapshot(tampered),
      /editor release identity trigger 계약이 다릅니다/,
      property,
    );
  }
});

test("uses a dedicated nullable audit sequence without rewriting the shared audit table", () => {
  const migration = fs.readFileSync(
    new URL(
      "../supabase/migrations/202608260007_editor_render_spec_v4_release_control.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    migration,
    /create sequence if not exists\s+shorts_mvp\.editor_render_v4_audit_event_sequence/,
  );
  assert.match(
    migration,
    /add column if not exists render_v4_event_sequence bigint;/,
  );
  assert.match(
    migration,
    /revoke all on sequence[\s\S]*from public,anon,authenticated,service_role;/,
  );
  assert.doesNotMatch(migration, /generated always as identity/i);
  assert.doesNotMatch(
    migration,
    /create\s+(?:unique\s+)?index[\s\S]{0,160}admin_audit_logs/i,
  );

  for (const [property, value] of [
    ["dataType", "integer"],
    ["cycles", true],
    ["incrementBy", "2"],
    ["cacheSize", "2"],
    ["startValue", "2"],
    ["minimumValue", "2"],
    ["maximumValue", "9223372036854775806"],
    ["serviceRoleUsage", false],
    ["serviceRoleSelect", false],
    ["serviceRoleUpdate", true],
    ["anonUsage", true],
    ["anonSelect", true],
    ["anonUpdate", true],
    ["authenticatedUsage", true],
    ["authenticatedSelect", true],
    ["authenticatedUpdate", true],
    ["publicUsage", true],
    ["publicSelect", true],
    ["publicUpdate", true],
    ["unexpectedGrantCount", 1],
  ]) {
    const tampered = validSnapshot();
    tampered.auditTransitionSequence[property] = value;
    assert.throws(
      () => validateEditorRenderV4ReleaseControlSnapshot(tampered),
      /전용 v4 audit sequence 계약이 다릅니다/,
      property,
    );
  }
});

test("requires a stopped rollout only for bootstrap and rotation leases", () => {
  const sha = "a".repeat(40);
  assert.equal(
    editorRenderV4InfrastructureLeaseRequiresStopped(`stage-b:bootstrap:${sha}`),
    true,
  );
  assert.equal(
    editorRenderV4InfrastructureLeaseRequiresStopped(`stage-b:rotation:${sha}`),
    true,
  );
  assert.equal(
    editorRenderV4InfrastructureLeaseRequiresStopped(`stage-b:lockdown:${sha}`),
    false,
  );
  assert.throws(
    () => editorRenderV4InfrastructureLeaseRequiresStopped("stage-b:lockdown:head"),
    /owner가 exact contract/,
  );
  const verifier = fs.readFileSync(
    new URL("./verify-editor-render-v4-release-control.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    verifier,
    /editorRenderV4InfrastructureLeaseRequiresStopped\(owner\)[\s\S]*renderV4KillSwitch/,
  );
  assert.match(
    verifier,
    /const requiresStopped = editorRenderV4InfrastructureLeaseRequiresStopped\(owner\)[\s\S]*\$\{!requiresStopped\}[\s\S]*render_v4_kill_switch=true/,
  );
});

test("fails closed when migration, immutable grants, or stop state is incomplete", () => {
  const missingColumn = validSnapshot();
  missingColumn.columns.pop();
  assert.throws(
    () => validateEditorRenderV4ReleaseControlSnapshot(missingColumn),
    /필수 열/,
  );

  const mutableTarget = validSnapshot();
  mutableTarget.projectTargetPrivileges.serviceRoleUpdate = true;
  assert.throws(
    () => validateEditorRenderV4ReleaseControlSnapshot(mutableTarget),
    /권한/,
  );

  const enabled = validSnapshot();
  enabled.releaseState.renderV4InternalEnabled = true;
  assert.throws(
    () => validateEditorRenderV4ReleaseControlSnapshot(enabled, {
      requireStopped: true,
    }),
    /kill switch=true/,
  );
  assert.doesNotThrow(
    () => validateEditorRenderV4ReleaseControlSnapshot(enabled),
  );
});

test("serializes catalog reads on the single read-only verifier connection", async () => {
  let inFlight = 0;
  let maximumInFlight = 0;
  let call = 0;
  const responses = [
    [],
    [],
    [],
    [],
    [{
      projectTargetsTable: "shorts_mvp.editor_release_project_targets",
      rowLevelSecurity: true,
      forceRowLevelSecurity: false,
      serviceRoleSelect: true,
      serviceRoleInsert: true,
      serviceRoleUpdate: false,
      serviceRoleDelete: false,
      anonAny: false,
      authenticatedAny: false,
    }],
    [],
    [],
    [],
    [],
  ];
  const sql = async () => {
    const response = responses[call++] || [];
    inFlight += 1;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight -= 1;
    return response;
  };

  const snapshot = await readEditorRenderV4ReleaseControlSnapshot(sql);
  assert.equal(call, responses.length);
  assert.equal(maximumInFlight, 1);
  assert.equal(
    snapshot.projectTargetsTable,
    "shorts_mvp.editor_release_project_targets",
  );
});
