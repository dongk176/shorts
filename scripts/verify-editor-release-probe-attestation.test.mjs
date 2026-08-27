import assert from "node:assert/strict";
import test from "node:test";
import {
  probeMigrationFunctionBody,
  validateEditorReleaseProbeAttestationSnapshot,
} from "./verify-editor-release-probe-attestation.mjs";

const columnTypes = {
  id: ["uuid", "NO"], nonce: ["text", "NO"], state: ["text", "NO"],
  git_sha: ["text", "NO"], worker_image_digest: ["text", "NO"],
  font_manifest_sha256: ["text", "NO"], github_repository: ["text", "NO"],
  github_repository_id: ["bigint", "NO"],
  github_repository_owner_id: ["bigint", "NO"],
  github_workflow_ref: ["text", "NO"], github_workflow_name: ["text", "NO"],
  github_release_ref: ["text", "NO"], github_environment: ["text", "NO"],
  github_workflow_run_id: ["bigint", "NO"],
  github_workflow_run_attempt: ["integer", "NO"],
  isolated_job_name: ["text", "YES"], isolated_job_queue_arn: ["text", "YES"],
  isolated_job_definition_arn: ["text", "YES"],
  isolated_batch_job_id: ["text", "YES"], artifact_uri: ["text", "YES"],
  manifest_s3_version_id: ["text", "YES"], manifest_sha256: ["text", "YES"],
  matrix_uri: ["text", "YES"], matrix_s3_version_id: ["text", "YES"],
  matrix_sha256: ["text", "YES"], expected_candidate_release_id: ["uuid", "YES"],
  expected_state_revision: ["bigint", "NO"], finalized_release_id: ["uuid", "YES"],
  reserved_at: ["timestamp with time zone", "NO"],
  job_attached_at: ["timestamp with time zone", "YES"],
  evidence_verified_at: ["timestamp with time zone", "YES"],
  finalized_at: ["timestamp with time zone", "YES"],
  expires_at: ["timestamp with time zone", "NO"],
};

const functionContracts = {
  advance_editor_release_state_revision: [
    "shorts_mvp.advance_editor_release_state_revision()", "trigger", false,
    "shorts_mvp, pg_temp",
  ],
  protect_editor_release_probe_identity: [
    "shorts_mvp.protect_editor_release_probe_identity()", "trigger", false,
    "shorts_mvp, pg_temp",
  ],
  reserve_editor_release_probe_v4: [
    "shorts_mvp.reserve_editor_release_probe_v4(text,text,text,text,bigint,bigint,text,text,text,text,bigint,integer)",
    "jsonb", true, "shorts_mvp, extensions, pg_temp",
  ],
  attach_editor_release_probe_job_v4: [
    "shorts_mvp.attach_editor_release_probe_job_v4(uuid,text,text,text,text,text)",
    "jsonb", true, "shorts_mvp, pg_temp",
  ],
  attach_editor_release_probe_evidence_v4: [
    "shorts_mvp.attach_editor_release_probe_evidence_v4(uuid,text,text,text,text,text,text,text)",
    "jsonb", true, "shorts_mvp, pg_temp",
  ],
  finalize_editor_render_v4_release: [
    "shorts_mvp.finalize_editor_render_v4_release(uuid,text,text,jsonb,jsonb,text,text)",
    "jsonb", true, "shorts_mvp, pg_temp",
  ],
};

function validSnapshot() {
  const requiredDefinitions = [
    "PRIMARY KEY (id)",
    "UNIQUE (nonce)",
    "UNIQUE (github_repository_id, github_workflow_run_id, github_workflow_run_attempt, git_sha, worker_image_digest)",
    "FOREIGN KEY expected_candidate_release_id REFERENCES shorts_mvp.editor_releases(id) ON DELETE RESTRICT",
    "FOREIGN KEY finalized_release_id REFERENCES shorts_mvp.editor_releases(id) ON DELETE RESTRICT",
    "CHECK state = 'reserved'::text state = 'job_submitted'::text state = 'evidence_verified'::text state = 'finalized'::text state = 'rejected'::text",
    "CHECK sha256:",
    "CHECK refs/tags/",
    "CHECK expected_state_revision >= 0",
  ];
  while (requiredDefinitions.length < 20) {
    requiredDefinitions.push(`CHECK harmless-${requiredDefinitions.length}`);
  }
  return {
    tableName: "shorts_mvp.editor_release_probe_runs",
    tableSecurity: { rowLevelSecurity: true, forceRowLevelSecurity: false },
    tablePrivileges: {
      serviceRoleSelect: true,
      serviceRoleInsert: false,
      serviceRoleUpdate: false,
      serviceRoleDelete: false,
      anonAny: false,
      authenticatedAny: false,
      publicAny: false,
    },
    columns: Object.entries(columnTypes).map(([columnName, [dataType, isNullable]]) => ({
      columnName, dataType, isNullable,
    })),
    constraints: requiredDefinitions.map((definition, index) => ({
      constraintName: `constraint_${index}`,
      constraintType: "c",
      validated: true,
      definition,
    })),
    triggers: [
      {
        triggerName: "editor_release_state_advance_registration_revision",
        enabled: "O",
        type: 19,
        definition: "CREATE TRIGGER editor_release_state_advance_registration_revision BEFORE UPDATE ON shorts_mvp.editor_release_state FOR EACH ROW EXECUTE FUNCTION shorts_mvp.advance_editor_release_state_revision()",
      },
      {
        triggerName: "editor_release_probe_runs_protect_identity",
        enabled: "O",
        type: 27,
        definition: "CREATE TRIGGER editor_release_probe_runs_protect_identity BEFORE DELETE OR UPDATE ON shorts_mvp.editor_release_probe_runs FOR EACH ROW EXECUTE FUNCTION shorts_mvp.protect_editor_release_probe_identity()",
      },
    ],
    functions: Object.entries(functionContracts).map(([
      functionName,
      [signature, returnType, securityDefiner, searchPath],
    ]) => ({
      functionName,
      signature,
      language: "plpgsql",
      returnType,
      securityDefiner,
      volatility: "v",
      searchPath,
      source: probeMigrationFunctionBody(functionName),
      serviceRoleExecute: true,
      anonExecute: false,
      authenticatedExecute: false,
      publicExecute: false,
      unexpectedExecuteGrantCount: 0,
    })),
    revisionColumn: { dataType: "bigint", isNullable: "NO", columnDefault: "0" },
    releaseState: { releaseRegistrationRevision: 0 },
    probeCount: 0,
    invalidProbeCount: 0,
  };
}

test("accepts the exact additive probe attestation schema before bootstrap", () => {
  assert.equal(
    validateEditorReleaseProbeAttestationSnapshot(validSnapshot(), {
      requireEmpty: true,
    }).tableName,
    "shorts_mvp.editor_release_probe_runs",
  );
});

test("pins atomic finalization to exact checks, five targets, CAS state, and one probe", () => {
  const body = probeMigrationFunctionBody("finalize_editor_render_v4_release");
  assert.match(body, /jsonb_array_length\(p_release_checks\)<>15/);
  assert.match(body, /v_check_names is distinct from v_expected_check_names/);
  assert.match(body, /jsonb_object_length\(p_project_targets\)<>5/);
  assert.match(body, /workerSourceGitSha'<>v_probe\.git_sha/);
  assert.match(body, /workerImageDigest'<>v_probe\.worker_image_digest/);
  assert.match(body, /release_registration_revision=v_probe\.expected_state_revision/);
  assert.match(body, /state='finalized',finalized_release_id=v_release\.id/);
  assert.doesNotMatch(body, /update shorts_mvp\.editor_releases/);
});

test("rejects schema drift, probe table mutation grants, and reused probe rows", () => {
  const wrongAcl = validSnapshot();
  wrongAcl.tablePrivileges.serviceRoleInsert = true;
  assert.throws(
    () => validateEditorReleaseProbeAttestationSnapshot(wrongAcl),
    /RLS\/ACL 계약이 다릅니다/,
  );

  const tamperedFunction = validSnapshot();
  tamperedFunction.functions.find((entry) => (
    entry.functionName === "finalize_editor_render_v4_release"
  )).source = "begin return '{}'::jsonb; end;";
  assert.throws(
    () => validateEditorReleaseProbeAttestationSnapshot(tamperedFunction),
    /함수 exact contract가 다릅니다/,
  );

  const reused = validSnapshot();
  reused.probeCount = 1;
  assert.throws(
    () => validateEditorReleaseProbeAttestationSnapshot(reused, { requireEmpty: true }),
    /probe 행이 이미 존재합니다/,
  );
});
