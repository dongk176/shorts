#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "../web/node_modules/postgres/src/index.js";
import { requireProductionDatabaseUrl } from "./production-database-identity.mjs";

const migrationPath = path.resolve(
  import.meta.dirname,
  "../supabase/migrations/202608260008_editor_release_probe_attestation.sql",
);

const FUNCTION_CONTRACTS = Object.freeze({
  advance_editor_release_state_revision: {
    signature: "shorts_mvp.advance_editor_release_state_revision()",
    returnType: "trigger",
    securityDefiner: false,
    searchPath: "shorts_mvp, pg_temp",
  },
  protect_editor_release_probe_identity: {
    signature: "shorts_mvp.protect_editor_release_probe_identity()",
    returnType: "trigger",
    securityDefiner: false,
    searchPath: "shorts_mvp, pg_temp",
  },
  reserve_editor_release_probe_v4: {
    signature: "shorts_mvp.reserve_editor_release_probe_v4(text,text,text,text,bigint,bigint,text,text,text,text,bigint,integer)",
    returnType: "jsonb",
    securityDefiner: true,
    searchPath: "shorts_mvp, extensions, pg_temp",
  },
  attach_editor_release_probe_job_v4: {
    signature: "shorts_mvp.attach_editor_release_probe_job_v4(uuid,text,text,text,text,text)",
    returnType: "jsonb",
    securityDefiner: true,
    searchPath: "shorts_mvp, pg_temp",
  },
  attach_editor_release_probe_evidence_v4: {
    signature: "shorts_mvp.attach_editor_release_probe_evidence_v4(uuid,text,text,text,text,text,text,text)",
    returnType: "jsonb",
    securityDefiner: true,
    searchPath: "shorts_mvp, pg_temp",
  },
  finalize_editor_render_v4_release: {
    signature: "shorts_mvp.finalize_editor_render_v4_release(uuid,text,text,jsonb,jsonb,text,text)",
    returnType: "jsonb",
    securityDefiner: true,
    searchPath: "shorts_mvp, pg_temp",
  },
});

const PROBE_COLUMNS = Object.freeze({
  id: ["uuid", "NO"],
  nonce: ["text", "NO"],
  state: ["text", "NO"],
  git_sha: ["text", "NO"],
  worker_image_digest: ["text", "NO"],
  font_manifest_sha256: ["text", "NO"],
  github_repository: ["text", "NO"],
  github_repository_id: ["bigint", "NO"],
  github_repository_owner_id: ["bigint", "NO"],
  github_workflow_ref: ["text", "NO"],
  github_workflow_name: ["text", "NO"],
  github_release_ref: ["text", "NO"],
  github_environment: ["text", "NO"],
  github_workflow_run_id: ["bigint", "NO"],
  github_workflow_run_attempt: ["integer", "NO"],
  isolated_job_name: ["text", "YES"],
  isolated_job_queue_arn: ["text", "YES"],
  isolated_job_definition_arn: ["text", "YES"],
  isolated_batch_job_id: ["text", "YES"],
  artifact_uri: ["text", "YES"],
  manifest_s3_version_id: ["text", "YES"],
  manifest_sha256: ["text", "YES"],
  matrix_uri: ["text", "YES"],
  matrix_s3_version_id: ["text", "YES"],
  matrix_sha256: ["text", "YES"],
  expected_candidate_release_id: ["uuid", "YES"],
  expected_state_revision: ["bigint", "NO"],
  finalized_release_id: ["uuid", "YES"],
  reserved_at: ["timestamp with time zone", "NO"],
  job_attached_at: ["timestamp with time zone", "YES"],
  evidence_verified_at: ["timestamp with time zone", "YES"],
  finalized_at: ["timestamp with time zone", "YES"],
  expires_at: ["timestamp with time zone", "NO"],
});

const REQUIRED_CONSTRAINT_FRAGMENTS = Object.freeze([
  "PRIMARY KEY (id)",
  "UNIQUE (nonce)",
  "github_repository_id, github_workflow_run_id, github_workflow_run_attempt, git_sha, worker_image_digest",
  "REFERENCES shorts_mvp.editor_releases(id) ON DELETE RESTRICT",
  "state = 'reserved'::text",
  "state = 'job_submitted'::text",
  "state = 'evidence_verified'::text",
  "state = 'finalized'::text",
  "state = 'rejected'::text",
  "sha256:",
  "refs/tags/",
  "expected_state_revision >= 0",
]);

export function normalizeDatabaseDefinition(value) {
  return String(value || "").trim().replace(/\s+/gu, " ");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function probeMigrationFunctionBody(functionName) {
  const migration = fs.readFileSync(migrationPath, "utf8");
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `create or replace function shorts_mvp\\.${escaped}\\([\\s\\S]*?\\nas \\$\\$\\n([\\s\\S]*?)\\n\\$\\$;`,
    "i",
  ).exec(migration);
  if (!match) throw new Error(`probe migration 함수 본문을 찾을 수 없습니다: ${functionName}`);
  return match[1];
}

const FUNCTION_HASHES = Object.freeze(Object.fromEntries(
  Object.keys(FUNCTION_CONTRACTS).map((name) => [
    name,
    sha256(normalizeDatabaseDefinition(probeMigrationFunctionBody(name))),
  ]),
));

function exactFunction(functions, name) {
  const value = functions.find((entry) => entry.functionName === name);
  const expected = FUNCTION_CONTRACTS[name];
  if (
    !value
    || value.signature !== expected.signature
    || value.language !== "plpgsql"
    || value.returnType !== expected.returnType
    || value.securityDefiner !== expected.securityDefiner
    || value.volatility !== "v"
    || value.searchPath !== expected.searchPath
    || sha256(normalizeDatabaseDefinition(value.source)) !== FUNCTION_HASHES[name]
    || value.serviceRoleExecute !== true
    || value.anonExecute !== false
    || value.authenticatedExecute !== false
    || value.publicExecute !== false
    || Number(value.unexpectedExecuteGrantCount) !== 0
  ) {
    throw new Error(`editor release probe 함수 exact contract가 다릅니다: ${name}`);
  }
}

export function validateEditorReleaseProbeAttestationSnapshot(
  snapshot,
  { requireEmpty = false } = {},
) {
  if (snapshot?.tableName !== "shorts_mvp.editor_release_probe_runs") {
    throw new Error("운영 DB에 editor_release_probe_runs가 없습니다.");
  }
  if (
    snapshot?.tableSecurity?.rowLevelSecurity !== true
    || snapshot?.tableSecurity?.forceRowLevelSecurity !== false
    || snapshot?.tablePrivileges?.serviceRoleSelect !== true
    || snapshot?.tablePrivileges?.serviceRoleInsert !== false
    || snapshot?.tablePrivileges?.serviceRoleUpdate !== false
    || snapshot?.tablePrivileges?.serviceRoleDelete !== false
    || snapshot?.tablePrivileges?.anonAny !== false
    || snapshot?.tablePrivileges?.authenticatedAny !== false
    || snapshot?.tablePrivileges?.publicAny !== false
  ) {
    throw new Error("editor_release_probe_runs의 RLS/ACL 계약이 다릅니다.");
  }
  const columns = new Map((snapshot?.columns || []).map((entry) => [
    entry.columnName,
    entry,
  ]));
  if (columns.size !== Object.keys(PROBE_COLUMNS).length) {
    throw new Error("editor_release_probe_runs의 열 개수가 exact contract와 다릅니다.");
  }
  for (const [name, [dataType, nullable]] of Object.entries(PROBE_COLUMNS)) {
    const actual = columns.get(name);
    if (!actual || actual.dataType !== dataType || actual.isNullable !== nullable) {
      throw new Error(`editor_release_probe_runs.${name} 열 계약이 다릅니다.`);
    }
  }
  const definitions = (snapshot?.constraints || []).map((entry) => (
    normalizeDatabaseDefinition(entry.definition)
  ));
  if ((snapshot?.constraints || []).length !== 20) {
    throw new Error("editor_release_probe_runs의 제약 개수가 exact contract와 다릅니다.");
  }
  for (const fragment of REQUIRED_CONSTRAINT_FRAGMENTS) {
    if (!definitions.some((definition) => definition.includes(fragment))) {
      throw new Error(`editor_release_probe_runs 필수 제약이 없습니다: ${fragment}`);
    }
  }
  const triggerMap = new Map((snapshot?.triggers || []).map((entry) => [
    entry.triggerName,
    entry,
  ]));
  const revision = triggerMap.get("editor_release_state_advance_registration_revision");
  const protector = triggerMap.get("editor_release_probe_runs_protect_identity");
  if (
    revision?.enabled !== "O"
    || revision?.type !== 19
    || !/^CREATE TRIGGER editor_release_state_advance_registration_revision BEFORE UPDATE ON shorts_mvp\.editor_release_state FOR EACH ROW EXECUTE FUNCTION shorts_mvp\.advance_editor_release_state_revision\(\)$/.test(
      normalizeDatabaseDefinition(revision?.definition),
    )
  ) {
    throw new Error("editor release state revision trigger 계약이 다릅니다.");
  }
  if (
    protector?.enabled !== "O"
    || protector?.type !== 27
    || !/^CREATE TRIGGER editor_release_probe_runs_protect_identity BEFORE (?:DELETE OR UPDATE|UPDATE OR DELETE) ON shorts_mvp\.editor_release_probe_runs FOR EACH ROW EXECUTE FUNCTION shorts_mvp\.protect_editor_release_probe_identity\(\)$/.test(
      normalizeDatabaseDefinition(protector?.definition),
    )
  ) {
    throw new Error("editor release probe immutable trigger 계약이 다릅니다.");
  }
  if (
    snapshot?.revisionColumn?.dataType !== "bigint"
    || snapshot?.revisionColumn?.isNullable !== "NO"
    || !/^(?:0|'0'::bigint)$/.test(String(snapshot?.revisionColumn?.columnDefault || ""))
    || !Number.isInteger(Number(snapshot?.releaseState?.releaseRegistrationRevision))
    || Number(snapshot?.releaseState?.releaseRegistrationRevision) < 0
  ) {
    throw new Error("editor release registration revision 계약이 다릅니다.");
  }
  const functions = snapshot?.functions || [];
  if (functions.length !== Object.keys(FUNCTION_CONTRACTS).length) {
    throw new Error("editor release probe 함수 개수가 exact contract와 다릅니다.");
  }
  for (const name of Object.keys(FUNCTION_CONTRACTS)) exactFunction(functions, name);
  if (Number(snapshot?.invalidProbeCount) !== 0) {
    throw new Error("editor release probe 상태/증거 계약을 위반한 행이 있습니다.");
  }
  if (requireEmpty && Number(snapshot?.probeCount) !== 0) {
    throw new Error("초기 bootstrap 전 editor release probe 행이 이미 존재합니다.");
  }
  return snapshot;
}

export async function readEditorReleaseProbeAttestationSnapshot(sql) {
  const columns = await sql`
    select column_name,data_type,is_nullable,column_default
    from information_schema.columns
    where table_schema='shorts_mvp' and table_name='editor_release_probe_runs'
    order by ordinal_position
  `;
  const constraints = await sql`
    select conname as constraint_name,contype::text as constraint_type,
      convalidated as validated,pg_get_constraintdef(oid,true) as definition
    from pg_constraint
    where conrelid='shorts_mvp.editor_release_probe_runs'::regclass
    order by conname
  `;
  const objects = await sql`
    select target.oid::regclass::text as table_name,
      target.relrowsecurity as row_level_security,
      target.relforcerowsecurity as force_row_level_security,
      has_table_privilege('service_role',target.oid,'SELECT') as service_role_select,
      has_table_privilege('service_role',target.oid,'INSERT') as service_role_insert,
      has_table_privilege('service_role',target.oid,'UPDATE') as service_role_update,
      has_table_privilege('service_role',target.oid,'DELETE') as service_role_delete,
      (has_table_privilege('anon',target.oid,'SELECT')
        or has_table_privilege('anon',target.oid,'INSERT')
        or has_table_privilege('anon',target.oid,'UPDATE')
        or has_table_privilege('anon',target.oid,'DELETE')) as anon_any,
      (has_table_privilege('authenticated',target.oid,'SELECT')
        or has_table_privilege('authenticated',target.oid,'INSERT')
        or has_table_privilege('authenticated',target.oid,'UPDATE')
        or has_table_privilege('authenticated',target.oid,'DELETE')) as authenticated_any,
      exists (
        select 1 from aclexplode(coalesce(target.relacl,acldefault('r',target.relowner))) acl
        where acl.grantee=0 and acl.privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
      ) as public_any
    from pg_class target
    where target.oid='shorts_mvp.editor_release_probe_runs'::regclass
  `;
  const triggers = await sql`
    select tgname as trigger_name,tgenabled::text as enabled,tgtype::integer as type,
      pg_get_triggerdef(oid,true) as definition
    from pg_trigger
    where not tgisinternal and (
      (tgrelid='shorts_mvp.editor_release_state'::regclass
        and tgname='editor_release_state_advance_registration_revision')
      or (tgrelid='shorts_mvp.editor_release_probe_runs'::regclass
        and tgname='editor_release_probe_runs_protect_identity')
    )
    order by tgname
  `;
  const functions = await sql`
    select p.oid::regprocedure::text as signature,p.proname as function_name,
      language.lanname as language,p.prorettype::regtype::text as return_type,
      p.prosecdef as security_definer,p.provolatile::text as volatility,
      coalesce((select regexp_replace(setting,'^search_path=','')
        from unnest(coalesce(p.proconfig,array[]::text[])) setting
        where setting like 'search_path=%'),'') as search_path,
      p.prosrc as source,
      has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute,
      has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
      exists (select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where acl.grantee=0 and acl.privilege_type='EXECUTE') as public_execute,
      (select count(*)::integer
        from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where acl.grantee<>p.proowner and (
          acl.grantee<>(select oid from pg_roles where rolname='service_role')
          or acl.privilege_type<>'EXECUTE' or acl.is_grantable
        )) as unexpected_execute_grant_count
    from pg_proc p join pg_language language on language.oid=p.prolang
    where p.proname=any(${Object.keys(FUNCTION_CONTRACTS)})
      and p.pronamespace='shorts_mvp'::regnamespace
    order by p.proname
  `;
  const revisionColumns = await sql`
    select data_type,is_nullable,column_default
    from information_schema.columns
    where table_schema='shorts_mvp' and table_name='editor_release_state'
      and column_name='release_registration_revision'
  `;
  const states = await sql`
    select release_registration_revision
    from shorts_mvp.editor_release_state where singleton
  `;
  const counts = await sql`
    select count(*)::integer as probe_count,
      count(*) filter (where
        expected_state_revision<0
        or (state='reserved' and isolated_batch_job_id is not null)
        or (state='job_submitted' and isolated_batch_job_id is null)
        or (state='evidence_verified' and (
          artifact_uri is null or manifest_s3_version_id is null
          or matrix_s3_version_id is null))
        or (state='finalized' and finalized_release_id is null)
      )::integer as invalid_probe_count
    from shorts_mvp.editor_release_probe_runs
  `;
  return {
    tableName: objects[0]?.tableName || null,
    tableSecurity: objects[0] ? {
      rowLevelSecurity: objects[0].rowLevelSecurity,
      forceRowLevelSecurity: objects[0].forceRowLevelSecurity,
    } : null,
    tablePrivileges: objects[0] || null,
    columns,
    constraints,
    triggers,
    functions,
    revisionColumn: revisionColumns[0] || null,
    releaseState: states[0] || null,
    probeCount: counts[0]?.probeCount ?? null,
    invalidProbeCount: counts[0]?.invalidProbeCount ?? null,
  };
}

function databaseOptions() {
  return {
    max: 1,
    prepare: false,
    connect_timeout: 15,
    idle_timeout: 5,
    connection: {
      application_name: "easycut-editor-release-probe-verifier",
      default_transaction_read_only: true,
      statement_timeout: 15_000,
    },
    transform: postgres.camel,
  };
}

export async function verifyEditorReleaseProbeAttestation({
  environment = process.env,
  requireEmpty = false,
} = {}) {
  const databaseUrl = requireProductionDatabaseUrl(environment);
  const sql = postgres(databaseUrl, databaseOptions());
  try {
    return validateEditorReleaseProbeAttestationSnapshot(
      await readEditorReleaseProbeAttestationSnapshot(sql),
      { requireEmpty },
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(argv = process.argv.slice(2)) {
  if (argv.some((value) => value !== "--require-empty")) {
    throw new Error("사용법: verify-editor-release-probe-attestation.mjs [--require-empty]");
  }
  await verifyEditorReleaseProbeAttestation({ requireEmpty: argv.includes("--require-empty") });
  process.stdout.write("Editor release probe attestation schema: verified\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
