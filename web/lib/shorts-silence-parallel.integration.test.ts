import { readFile } from "node:fs/promises";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
const admin = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";
const release = "11111111-1111-4111-8111-111111111111";
const privateQueue = "arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-editor-test";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema shorts_mvp;
    create table shorts_mvp.app_users(id uuid primary key,is_admin boolean);
    insert into shorts_mvp.app_users values ('${admin}',true),('${user}',false);
    create table shorts_mvp.editor_releases(id uuid primary key,status text,git_sha text,worker_image_digest text,staging_verified_at timestamptz,render_spec_version int,caption_render_spec_version int);
    insert into shorts_mvp.editor_releases values ('${release}','canary_ready','sha','digest',now(),4,4);
    create table shorts_mvp.editor_release_project_targets(release_id uuid,target_key text,batch_target_release_id text,job_definition_arn text,worker_source_git_sha text,worker_image_digest text);
    insert into shorts_mvp.editor_release_project_targets values ('${release}','source_range','target','definition','sha','digest');
    create table shorts_mvp.runtime_feature_flags(flag_key text,enabled boolean);
    insert into shorts_mvp.runtime_feature_flags values ('editor_rendering_v2',true),('admin_shorts_silence',true);
    create table shorts_mvp.editor_release_state(singleton boolean,render_v4_target_successor jsonb,render_v4_kill_switch boolean,render_v4_infra_lease_id uuid,render_v4_infra_lease_expires_at timestamptz,public_enabled boolean,render_v4_rollout_percent int,stable_release_id uuid);
    insert into shorts_mvp.editor_release_state values(true,'{"version":1,"phase":"active","activeReleaseId":"${release}","activeRegistry":{"lanes":{"source_range":{"current":{"releaseId":"stable","jobDefinitionArn":"stable-definition","jobQueueArn":"stable-queue"}}}}}',false,null,null,true,100,'${release}');
    create table shorts_mvp.video_jobs(id uuid primary key default gen_random_uuid(),user_id uuid,source_type text default 'youtube',pipeline_version int default 2,is_example boolean default false,output_language text default 'ko',custom_template_id uuid,midform_request jsonb,language_test_release_id uuid,source_language_hint text,template_snapshot jsonb default '{"shortsSilenceRemoval":{"version":1,"preset":"aggressive"}}',initial_editor_release_id uuid default '${release}',initial_render_spec_version int default 4,initial_caption_render_spec_version int default 4,batch_target_key text default 'source_range',batch_target_release_id text default 'target',batch_job_definition text default 'definition',batch_job_queue text default '${privateQueue}',status text default 'queued');
    create table shorts_mvp.generated_shorts(id uuid primary key,job_id uuid,user_id uuid);
    create table shorts_mvp.editor_render_requests(id uuid default gen_random_uuid(),short_id uuid,user_id uuid,release_id uuid,release_channel text);
  `);
  const baseline = await readFile(new URL('./fixtures/silence-test-production-admission.sql', import.meta.url), 'utf8');
  await db.exec(baseline);
  await db.exec(`create trigger admission before insert on shorts_mvp.video_jobs for each row execute function shorts_mvp.enforce_project_target_successor_admission()`);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261105075326_admin_silence_isolated_admission.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../supabase/migrations/20261106103733_silence_admin_matrix_scope.sql', import.meta.url), 'utf8'));
  const languageMigration = await readFile(new URL('../../supabase/migrations/202609120001_admin_language_test.sql', import.meta.url), 'utf8');
  const languageConstraint = languageMigration.slice(languageMigration.indexOf('add constraint video_jobs_language_test_context'), languageMigration.indexOf('create index video_jobs_language_test_active')).trim();
  await db.exec(`alter table shorts_mvp.video_jobs ${languageConstraint}`);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261106125630_silence_admin_language_context.sql', import.meta.url), 'utf8'));
  const publicLanguage = await readFile(new URL('../../supabase/migrations/202609150001_language_public_and_guide.sql', import.meta.url), 'utf8');
  await db.exec(publicLanguage.slice(publicLanguage.indexOf('create function shorts_mvp.enforce_language_request_binding()')).replace(/commit;\s*$/, ''));
  await db.exec(await readFile(new URL('../../supabase/migrations/20261106140117_silence_admin_language_request.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into shorts_mvp.silence_test_releases(id,administrator_id,expires_at,enabled,verified_at,job_queue_arn) values('${release}','${admin}',now()+interval '3 hours',true,now(),'${privateQueue}')`);
  await db.exec(`alter table shorts_mvp.editor_releases add column font_manifest_sha256 text default 'font', add column production_job_definition_arn text, add column ui_version int default 3, add column document_version int default 3;
    alter table shorts_mvp.editor_release_project_targets add column job_queue_arn text default 'production-queue';
    alter table shorts_mvp.video_jobs add column user_deleted_at timestamptz;
    alter table shorts_mvp.generated_shorts add column deleted_at timestamptz,add column expires_at timestamptz default now()+interval '1 day';
    insert into shorts_mvp.runtime_feature_flags values ('public_shorts_silence',true);
    create function shorts_mvp._project_target_successor_contract(uuid,uuid,boolean) returns jsonb language sql as $$select '{}'::jsonb$$;`);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261106181941_shorts_silence_parallel_admission.sql', import.meta.url), 'utf8'));
});

afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`delete from shorts_mvp.editor_render_requests;delete from shorts_mvp.generated_shorts;delete from shorts_mvp.video_jobs;
    update shorts_mvp.shorts_silence_routing set enabled=true,percentage=100,release_id=null;
    delete from shorts_mvp.shorts_silence_routes;
    update shorts_mvp.editor_release_state set render_v4_kill_switch=false;
    update shorts_mvp.runtime_feature_flags set enabled=true;`);
  // Fixture evidence only; registration's real finalized checks are tested in
  // test_project_target_successor_postgres.py. No production writes here.
  const proof = { sourceGitSha:'sha', workerImageDigest:'digest',fontManifestSha256:'font',newTargets:{source_range:{jobDefinitionArn:'definition',jobQueueArn:'production-queue'}} };
  await db.query(`insert into shorts_mvp.shorts_silence_routes(release_id,predecessor_release_id,proof,registered_by) values($1,$1,$2,$3)`,[release,proof,admin]);
  await db.exec(`update shorts_mvp.shorts_silence_routing set release_id='${release}'`);
});
async function insert(owner=user, language='ko') {
  return db.query<{id:string}>(`insert into shorts_mvp.video_jobs(user_id,silence_inline_release_id,output_language,source_language_hint,batch_job_queue)
    values($1,$2,$3,'auto','production-queue') returning id`,[owner,release,language]);
}
describe('parallel admission with private guards retained',()=>{
  it.each(['ko','en','ja'])('admits selected %s ordinary jobs through exact binding',async language=>{
    await insert(user,language);
    expect((await db.query('select admitted_jobs from shorts_mvp.silence_test_releases')).rows[0]).toEqual({admitted_jobs:0});
  });
  it('does not stop ordinary unmarked jobs when parallel routing is disabled',async()=>{
    await db.exec('update shorts_mvp.shorts_silence_routing set enabled=false');
    await expect(insert()).rejects.toThrow('SILENCE_ROUTE_NOT_SELECTED');
    await db.exec(`insert into shorts_mvp.video_jobs(user_id,template_snapshot,batch_target_release_id,batch_job_definition,batch_job_queue)
      values('${user}','{}','stable','stable-definition','stable-queue')`);
  });
  it('blocks private QA access for general users',async()=>{
    await expect(db.exec(`insert into shorts_mvp.video_jobs(user_id,silence_test_release_id) values('${user}','${release}')`)).rejects.toThrow();
  });
  it('keeps existing admitted jobs bound after new admissions switch off',async()=>{
    const {rows:[job]}=await insert();
    await db.exec('update shorts_mvp.shorts_silence_routing set enabled=false');
    await db.query('select shorts_mvp.assert_shorts_silence_inline_job(j,false) from shorts_mvp.video_jobs j where id=$1',[job.id]);
    await expect(db.query('update shorts_mvp.video_jobs set silence_inline_release_id=null where id=$1',[job.id])).rejects.toThrow('SILENCE_ROUTE_IDENTITY_IMMUTABLE');
  });
  it('rejects target tampering and emergency stop',async()=>{
    await db.exec(`update shorts_mvp.editor_release_project_targets set job_queue_arn='wrong'`);
    await expect(insert()).rejects.toThrow('SILENCE_ROUTE_TARGET_INVALID');
    await db.exec(`update shorts_mvp.editor_release_project_targets set job_queue_arn='production-queue';update shorts_mvp.editor_release_state set render_v4_kill_switch=true`);
    await expect(insert()).rejects.toThrow('SILENCE_ROUTE_RENDERING_STOPPED');
  });
  it('validates edit ownership and allows pinned editing when new routing is disabled',async()=>{
    const {rows:[job]}=await insert();const short='44444444-4444-4444-8444-444444444444';
    await db.query('insert into shorts_mvp.generated_shorts(id,job_id,user_id) values($1,$2,$3)',[short,job.id,user]);
    await db.exec('update shorts_mvp.shorts_silence_routing set enabled=false');
    await db.query(`insert into shorts_mvp.editor_render_requests(short_id,user_id,release_id,release_channel) values($1,$2,$3,'canary')`,[short,user,release]);
    await expect(db.query(`insert into shorts_mvp.editor_render_requests(short_id,user_id,release_id,release_channel) values($1,$2,$3,'canary')`,[short,admin,release])).rejects.toThrow('SILENCE_ROUTE_EDITOR_OWNER_INVALID');
    await expect(db.query(`insert into shorts_mvp.editor_render_requests(short_id,user_id,release_id,release_channel) values($1,$2,$3,'stable')`,[short,user,release])).rejects.toThrow('SILENCE_ROUTE_EDITOR_PIN_INVALID');
  });
  it('does not grant browser roles the route registration RPC',async()=>{
    expect((await db.query(`select has_function_privilege('anon','shorts_mvp.register_shorts_silence_route(uuid,uuid,uuid)','EXECUTE') as allowed`)).rows).toEqual([{allowed:false}]);
  });
});
