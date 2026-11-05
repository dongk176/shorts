import { readFileSync } from "node:fs";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { expect, it } from "vitest";

const migration = readFileSync("../supabase/migrations/20261105062608_register_editor_release_without_selection.sql", "utf8");
const candidate = "11111111-1111-4111-8111-111111111111";
const stable = "22222222-2222-4222-8222-222222222222";
const probe = "33333333-3333-4333-8333-333333333333";
const git = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const nonce = "c".repeat(32);
const checks = ["browser-parity-worker-matrix", "browser-worker-visual-parity", "caption-render-spec-v4",
  "captured-timeline", "editor-v2", "ffprobe", "font-fallback", "font-manifest", "frame-parity",
  "legacy-no-timeline", "render-spec-v4", "runtime-identity", "worker-caption-noop-parity",
  "worker-image", "worker-title-compositor-parity"].map(checkName => ({
  checkName, artifactUri: checkName === "browser-worker-visual-parity" ? "s3://proof/matrix" : "s3://proof/manifest", details: {},
}));
const targets = Object.fromEntries(["legacy_project", "source_range", "elevenlabs_transcription",
  "subtitle_templates", "unified_template_subtitles"].map(lane => [lane, {
  batchTargetReleaseId: `${lane.replaceAll("_", "-")}-test-v4`, workerSourceGitSha: git,
  workerImageDigest: digest, renderSpecVersion: 4,
  jobDefinitionArn: `arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-editor-v4-${lane.replaceAll("_", "-")}-${git.slice(0, 12)}:1`,
  jobQueueArn: "arn:aws:batch:ap-northeast-2:181651591905:job-queue/existing-queue",
}]));

async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema shorts_mvp; grant usage on schema shorts_mvp to anon,authenticated,service_role;
    create table shorts_mvp.editor_release_state(singleton boolean primary key, candidate_release_id uuid,
      stable_release_id uuid,previous_stable_release_id uuid,public_enabled boolean,canary_enabled boolean,
      release_registration_revision bigint, render_v4_target_successor jsonb);
    create table shorts_mvp.file_upload_release_checks(check_key text primary key,passed boolean,details jsonb,successor jsonb);
    create table shorts_mvp.editor_releases(id uuid primary key default gen_random_uuid(),git_sha text,ui_version int,
      document_version int,worker_image_digest text,production_job_definition_arn text,subtitle_editing_capable boolean,
      render_spec_version int,caption_render_spec_version int,font_manifest_sha256 text,status text,staging_verified_at timestamptz);
    create table shorts_mvp.editor_release_probe_runs(id uuid primary key,nonce text,state text,git_sha text,
      worker_image_digest text,font_manifest_sha256 text,expires_at timestamptz,github_repository text,
      github_workflow_run_id bigint,github_workflow_run_attempt int,matrix_uri text,artifact_uri text,
      expected_candidate_release_id uuid,expected_state_revision bigint,finalized_release_id uuid,finalized_at timestamptz);
    create table shorts_mvp.editor_release_project_targets(release_id uuid,target_key text,batch_target_release_id text,
      worker_source_git_sha text,worker_image_digest text,job_definition_arn text,job_queue_arn text,primary key(release_id,target_key));
    create table shorts_mvp.editor_release_checks(release_id uuid,environment text,check_name text,status text,
      details jsonb,artifact_uri text,started_at timestamptz,completed_at timestamptz,primary key(release_id,environment,check_name));
    insert into shorts_mvp.editor_release_state values(true,'${candidate}','${stable}',null,true,false,9,'{"phase":"active"}');
    insert into shorts_mvp.file_upload_release_checks values('runtime_identity',true,'{"releaseId":"${candidate}"}',null);
    insert into shorts_mvp.editor_release_probe_runs(id,nonce,state,git_sha,worker_image_digest,font_manifest_sha256,
      expires_at,github_repository,github_workflow_run_id,github_workflow_run_attempt,matrix_uri,artifact_uri,
      expected_candidate_release_id,expected_state_revision)
    values('${probe}','${nonce}','evidence_verified','${git}','${digest}','${"d".repeat(64)}',now()+interval '1 hour',
      'dongk176/shorts',123,1,'s3://proof/matrix','s3://proof/manifest','${candidate}',9);`);
  await db.exec(migration);
  return db;
}
function register(db: PGlite, overrides: { nonce?: string; targets?: typeof targets; checks?: typeof checks } = {}) {
  return db.query<{ result: { releaseId: string; idempotent: boolean } }>(
    "select shorts_mvp.register_editor_render_v4_release($1::uuid,$2,$3,$4::jsonb,$5::jsonb,$6,$7) as result",
    [probe, overrides.nonce ?? nonce,
      `arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-editor-release-${git.slice(0, 12)}-4vcpu:1`,
      JSON.stringify(overrides.targets ?? targets), JSON.stringify(overrides.checks ?? checks), "e".repeat(64),
      "https://github.com/dongk176/shorts/actions/runs/123/attempts/1"],
  );
}
const selected = (db: PGlite) => db.query("select to_jsonb(s) as state,to_jsonb(u) as upload from shorts_mvp.editor_release_state s cross join shorts_mvp.file_upload_release_checks u");

it("registers verified artifacts without changing selected releases or upload eligibility, including retry", async () => {
  const db = await fixture();
  try {
    const before = await selected(db);
    await db.exec("set role service_role");
    const first = (await register(db)).rows[0].result;
    const second = (await register(db)).rows[0].result;
    expect(second).toMatchObject({ releaseId: first.releaseId, idempotent: true });
    await db.exec("reset role");
    expect((await selected(db)).rows).toEqual(before.rows);
    expect((await db.query("select count(*)::int as n from shorts_mvp.editor_release_project_targets")).rows).toEqual([{ n: 5 }]);
    expect((await db.query("select count(*)::int as n from shorts_mvp.editor_release_checks")).rows).toEqual([{ n: 15 }]);
  } finally { await db.close(); }
});

it.each(["anon", "authenticated"])("rejects registration by %s", async role => {
  const db = await fixture();
  try {
    await db.exec(`set role ${role}`);
    await expect(register(db)).rejects.toThrow(/permission denied/);
  } finally { await db.close(); }
});

it.each(["nonce", "expired", "state-changed", "missing-proof", "wrong-target"])("fails atomically for %s", async scenario => {
  const db = await fixture();
  try {
    if (scenario === "expired") await db.exec("update shorts_mvp.editor_release_probe_runs set expires_at=now()-interval '1 minute'");
    if (scenario === "state-changed") await db.exec("update shorts_mvp.editor_release_state set release_registration_revision=10");
    const before = await selected(db);
    const bad = structuredClone(targets);
    bad.source_range.workerImageDigest = `sha256:${"f".repeat(64)}`;
    await expect(register(db, {
      nonce: scenario === "nonce" ? "f".repeat(32) : nonce,
      checks: scenario === "missing-proof" ? checks.slice(1) : checks,
      targets: scenario === "wrong-target" ? bad : targets,
    })).rejects.toThrow();
    expect((await selected(db)).rows).toEqual(before.rows);
    expect((await db.query("select count(*)::int as n from shorts_mvp.editor_releases")).rows).toEqual([{ n: 0 }]);
  } finally { await db.close(); }
});
