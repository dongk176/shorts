import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "../test-tools/node_modules/@electric-sql/pglite/dist/index.js";

const migration = fs.readFileSync(new URL("../supabase/migrations/20261123145446_editor_render_successor.sql", import.meta.url), "utf8");
const admin = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const previous = "33333333-3333-4333-8333-333333333333";
const successor = "44444444-4444-4444-8444-444444444444";
const short = "55555555-5555-4555-8555-555555555555";
const job = "66666666-6666-4666-8666-666666666666";
const sha = "a".repeat(40), digest = `sha256:${"b".repeat(64)}`;
const checks = ["save-render-download", "gemini-comments", "reopen-reedit", "rollback-drill", "initial-project-admission"];

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema shorts_mvp;
    grant usage on schema shorts_mvp to anon,authenticated,service_role;
    create table shorts_mvp.app_users(id uuid primary key,is_admin boolean,withdrawn_at timestamptz);
    insert into shorts_mvp.app_users values('${admin}',true,null),('${other}',false,null);
    create table shorts_mvp.editor_releases(id uuid primary key,ui_version integer default 3,document_version integer default 3,
      render_spec_version integer default 4,caption_render_spec_version integer default 4,font_manifest_sha256 text default '${"c".repeat(64)}');
    insert into shorts_mvp.editor_releases(id) values('${previous}'),('${successor}');
    create table shorts_mvp.editor_release_state(singleton boolean primary key,stable_release_id uuid,public_enabled boolean,
      canary_enabled boolean,render_v4_kill_switch boolean,render_v4_rollout_percent integer,
      render_v4_infra_lease_id uuid,render_v4_infra_lease_expires_at timestamptz,render_v4_target_successor jsonb);
    insert into shorts_mvp.editor_release_state values(true,'${previous}',true,false,false,100,null,null,'{"version":1,"phase":"active"}');
    create table shorts_mvp.runtime_feature_flags(flag_key text,enabled boolean);
    insert into shorts_mvp.runtime_feature_flags values('editor_rendering_v2',true);
    create table shorts_mvp.editor_release_testers(user_id uuid,enabled boolean);
    insert into shorts_mvp.editor_release_testers values('${admin}',true);
    create table shorts_mvp.video_jobs(id uuid primary key,user_id uuid,user_deleted_at timestamptz,source_type text default 'youtube',
      pipeline_version integer default 2,template_snapshot jsonb default '{}',language_test_release_id uuid,
      silence_test_release_id uuid,silence_inline_release_id uuid,midform_release_id uuid);
    insert into shorts_mvp.video_jobs(id,user_id) values('${job}','${admin}');
    create table shorts_mvp.generated_shorts(id uuid primary key,job_id uuid,user_id uuid,deleted_at timestamptz,
      expires_at timestamptz default (now()+interval '1 day'),render_version integer default 1);
    insert into shorts_mvp.generated_shorts(id,job_id,user_id) values('${short}','${job}','${admin}');
    create table shorts_mvp.editor_render_requests(id serial primary key,short_id uuid,user_id uuid,base_render_version integer default 1,
      release_id uuid,release_channel text,status text default 'queued',completed_at timestamptz,batch_job_id text,worker_image_digest text);
    create table shorts_mvp.editor_release_checks(release_id uuid,environment text,check_name text,status text,
      completed_at timestamptz,artifact_uri text,details jsonb);
    create table shorts_mvp.admin_audit_logs(actor_user_id uuid,action text,entity_type text,entity_id text,metadata jsonb);
    create table shorts_mvp.test_proof(value jsonb);
    insert into shorts_mvp.test_proof values('{"workerImageDigest":"${digest}"}');
    create function shorts_mvp._project_target_successor_contract(uuid,uuid) returns jsonb language sql as $$select value from shorts_mvp.test_proof$$;
    create function shorts_mvp._project_target_successor_flags() returns jsonb language sql as $$select to_jsonb(s) from shorts_mvp.editor_release_state s$$;
  `);
  await db.exec(migration);
  return db;
}
async function configure(db, phase = "internal", actor = admin, source = sha) {
  return db.query("select shorts_mvp.configure_editor_render_successor($1,$2,$3,$4,$5)", [actor, previous, successor, source, phase]);
}
async function resolve(db, user = admin, source = sha) {
  return (await db.query("select * from shorts_mvp.resolve_editor_render_successor($1,$2,$3,$4)", [user, short, previous, source])).rows;
}
async function request(db, channel = "canary", user = admin) {
  return db.query("insert into shorts_mvp.editor_render_requests(short_id,user_id,release_id,release_channel) values($1,$2,$3,$4)", [short, user, successor, channel]);
}
async function evidence(db) {
  await request(db);
  await db.query("update shorts_mvp.editor_render_requests set status='succeeded',completed_at=now(),batch_job_id='actual-batch-id',worker_image_digest=$1", [digest]);
  for (const name of checks) await db.query("insert into shorts_mvp.editor_release_checks values($1,'production_canary',$2,'passed',now(),'s3://evidence/proof',$3)",
    [successor, name, { webSourceGitSha: sha, deploymentId: "dpl_verifiedCandidate" }]);
}

test("internal editing changes no generation state and admits only the owning tester", async () => {
  const db = await setup(); try {
    const baseline = (await db.query("select * from shorts_mvp.editor_release_state")).rows;
    await assert.rejects(configure(db, "internal", other), /ADMIN_REQUIRED/);
    await configure(db);
    assert.equal((await resolve(db))[0].release_channel, "canary");
    assert.deepEqual(await resolve(db, other), []);
    assert.deepEqual(await resolve(db, admin, "d".repeat(40)), []);
    await request(db);
    await assert.rejects(request(db, "stable"), /REQUEST_REJECTED/);
    await assert.rejects(request(db, "canary", other), /REQUEST_REJECTED/);
    assert.deepEqual((await db.query("select * from shorts_mvp.editor_release_state")).rows, baseline);
  } finally { await db.close(); }
});

test("promotion requires matching candidate evidence and a successful completed render", async () => {
  const db = await setup(); try {
    await assert.rejects(configure(db, "public"), /INTERNAL_REQUIRED/);
    await configure(db);
    await assert.rejects(configure(db, "public"), /CANARY_CHECKS_REQUIRED/);
    await evidence(db);
    await db.exec("update shorts_mvp.editor_render_requests set status='failed'");
    await assert.rejects(configure(db, "public"), /CANARY_RENDER_REQUIRED/);
    await db.exec("update shorts_mvp.editor_render_requests set status='succeeded'");
    await db.exec("update shorts_mvp.editor_release_checks set details=details||'{\"deploymentId\":\"dpl_other\"}' where check_name='reopen-reedit'");
    await assert.rejects(configure(db, "public"), /CANARY_CHECKS_REQUIRED/);
    await db.exec("update shorts_mvp.editor_release_checks set details=details||'{\"deploymentId\":\"dpl_verifiedCandidate\"}'");
    await configure(db, "public");
    await db.exec(`update shorts_mvp.generated_shorts set user_id='${other}'; update shorts_mvp.video_jobs set user_id='${other}';`);
    assert.equal((await resolve(db, other))[0].release_channel, "stable");
    await request(db, "stable", other);
    await configure(db, "off");
    assert.deepEqual(await resolve(db, other), []);
    await assert.rejects(request(db, "stable", other), /REQUEST_REJECTED/);
    assert.equal((await db.query("select count(*)::int as n from shorts_mvp.editor_render_requests")).rows[0].n, 2);
  } finally { await db.close(); }
});

test("changed provenance, kill switches, and missing ownership fail closed", async () => {
  const db = await setup(); try {
    await configure(db);
    await db.exec("update shorts_mvp.test_proof set value=value||'{\"changed\":true}'");
    assert.deepEqual(await resolve(db), []);
    await assert.rejects(configure(db), /PROOF_CHANGED/);
    await db.exec("update shorts_mvp.test_proof set value=value-'changed'");
    await db.exec("update shorts_mvp.editor_release_state set render_v4_kill_switch=true");
    assert.deepEqual(await resolve(db), []);
    await db.exec("update shorts_mvp.editor_release_state set render_v4_kill_switch=false");
    await db.exec("update shorts_mvp.generated_shorts set expires_at=now()-interval '1 day'");
    assert.deepEqual(await resolve(db), []);
    await assert.rejects(request(db), /REQUEST_REJECTED/);
  } finally { await db.close(); }
});

for (const field of ["language_test_release_id", "silence_test_release_id", "silence_inline_release_id", "midform_release_id"]) {
  test(`keeps ${field} projects on their dedicated editor binding`, async () => {
    const db = await setup(); try {
      await configure(db);
      await db.exec(`update shorts_mvp.video_jobs set ${field}='${successor}'`);
      assert.deepEqual(await resolve(db), []);
      await assert.rejects(request(db), /REQUEST_REJECTED/);
    } finally { await db.close(); }
  });
}

test("no direct public or runtime writes can enable the release", async () => {
  const db = await setup(); try {
    const result = await db.query(`select
      has_table_privilege('service_role','shorts_mvp.editor_render_successor','UPDATE') as runtime_update,
      has_table_privilege('authenticated','shorts_mvp.editor_render_successor','SELECT') as client_select,
      has_function_privilege('authenticated','shorts_mvp.configure_editor_render_successor(uuid,uuid,uuid,text,text)','EXECUTE') as client_execute`);
    assert.deepEqual(result.rows[0], { runtime_update: false, client_select: false, client_execute: false });
  } finally { await db.close(); }
});
