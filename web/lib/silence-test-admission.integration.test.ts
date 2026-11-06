import { readFile } from "node:fs/promises";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
const admin = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";
const release = "11111111-1111-4111-8111-111111111111";
const queue = "arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-editor-test";
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
    create table shorts_mvp.video_jobs(id uuid primary key default gen_random_uuid(),user_id uuid,source_type text default 'youtube',pipeline_version int default 2,is_example boolean default false,output_language text default 'ko',custom_template_id uuid,midform_request jsonb,language_test_release_id uuid,source_language_hint text,template_snapshot jsonb default '{"shortsSilenceRemoval":{"version":1,"preset":"aggressive"}}',initial_editor_release_id uuid default '${release}',initial_render_spec_version int default 4,initial_caption_render_spec_version int default 4,batch_target_key text default 'source_range',batch_target_release_id text default 'target',batch_job_definition text default 'definition',batch_job_queue text default '${queue}',status text default 'queued');
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
  await db.exec(`insert into shorts_mvp.silence_test_releases(id,administrator_id,expires_at,enabled,verified_at,job_queue_arn) values('${release}','${admin}',now()+interval '3 hours',true,now(),'${queue}')`);
});
beforeEach(async () => {
  await db.exec(`delete from shorts_mvp.editor_render_requests; delete from shorts_mvp.generated_shorts; delete from shorts_mvp.video_jobs;
    update shorts_mvp.silence_test_releases set enabled=true,admitted_jobs=0,max_jobs=2,verification='{}',expires_at=created_at+interval '3 hours';
    update shorts_mvp.editor_release_state set render_v4_kill_switch=false,render_v4_infra_lease_id=null;
    update shorts_mvp.runtime_feature_flags set enabled=true;`);
});
afterAll(async () => { await db?.close(); });
function insert(owner=admin, fields='', values='') {
  return db.query<{id:string}>(`insert into shorts_mvp.video_jobs(user_id,silence_test_release_id${fields}) values('${owner}','${release}'${values}) returning id`);
}
describe('isolated silence admission against the actual production guard', () => {
  it('admits an opted-in administrator and atomically counts it', async () => {
    await insert(); expect((await db.query('select admitted_jobs from shorts_mvp.silence_test_releases')).rows).toEqual([{admitted_jobs:1}]);
  });
  it.each(['ko', 'en', 'ja'])('requires an exact authorized scope for %s SNS QA', async language => {
    const fields = ',output_language,source_language_hint,template_snapshot';
    const values = `,'${language}','auto','{"snsTemplateVersion":1,"shortsSilenceRemoval":{"version":1,"preset":"aggressive"}}'`;
    await expect(insert(admin, fields, values)).rejects.toThrow('SILENCE_TEST_SCOPE_INVALID');
    const scope = { authorizedTestScope: { version: 1, sourceGitSha: 'sha', workerImageDigest: 'digest',
      outputLanguages: ['ko','en','ja'], templateKinds: ['standard','custom','sns','community'] } };
    await db.query('update shorts_mvp.silence_test_releases set verification=$1', [scope]);
    await insert(admin, fields, values);
    scope.authorizedTestScope.workerImageDigest = 'other';
    await db.query('update shorts_mvp.silence_test_releases set verification=$1', [scope]);
    await expect(insert(admin, fields, values)).rejects.toThrow('SILENCE_TEST_SCOPE_INVALID');
  });
  it('preserves ordinary production target validation', async () => {
    await db.exec(`insert into shorts_mvp.video_jobs(user_id,batch_target_release_id,batch_job_definition,batch_job_queue) values('${user}','stable','stable-definition','stable-queue')`);
    await expect(db.exec(`insert into shorts_mvp.video_jobs(user_id) values('${user}')`)).rejects.toThrow('INITIAL_RENDER_RELEASE_HANDOFF');
    expect((await db.query('select admitted_jobs from shorts_mvp.silence_test_releases')).rows).toEqual([{admitted_jobs:0}]);
  });
  it('keeps ordinary language hints bound to a language release', async () => {
    await expect(db.exec(`insert into shorts_mvp.video_jobs(user_id,batch_target_release_id,batch_job_definition,batch_job_queue,source_language_hint)
      values('${user}','stable','stable-definition','stable-queue','en')`)).rejects.toThrow('video_jobs_language_test_context');
  });
  it('rejects a member spoofing the private marker', async () => { await expect(insert(user)).rejects.toThrow('SILENCE_TEST_UNAVAILABLE'); });
  it.each([
    ['source_type',"'upload'"], ['output_language',"'de'"], ['is_example','true'],
    ['template_snapshot',"'{}'"], ['initial_render_spec_version','3'],
    ['initial_editor_release_id','null'],
  ])('rejects incompatible %s', async (field,value) => {
    await expect(insert(admin,','+field,','+value)).rejects.toThrow('SILENCE_TEST_BINDING_INVALID');
  });
  it('rejects a different target or queue', async () => {
    await expect(insert(admin,',batch_job_queue',",'stable-queue'")).rejects.toThrow('SILENCE_TEST_TARGET_INVALID');
    await expect(insert(admin,',batch_job_definition',",'another'")).rejects.toThrow('SILENCE_TEST_TARGET_INVALID');
  });
  it('honors disabled gate and global emergency stop', async () => {
    await db.exec('update shorts_mvp.silence_test_releases set enabled=false');
    await expect(insert()).rejects.toThrow('SILENCE_TEST_UNAVAILABLE');
    await db.exec('update shorts_mvp.silence_test_releases set enabled=true; update shorts_mvp.editor_release_state set render_v4_kill_switch=true');
    await expect(insert()).rejects.toThrow('SILENCE_TEST_STOPPED');
  });
  it('honors infrastructure leases and runtime flag', async () => {
    await db.exec(`update shorts_mvp.editor_release_state set render_v4_infra_lease_id='${release}',render_v4_infra_lease_expires_at=now()+interval '1 hour'`);
    await expect(insert()).rejects.toThrow('SILENCE_TEST_STOPPED');
    await db.exec("update shorts_mvp.editor_release_state set render_v4_infra_lease_id=null; update shorts_mvp.runtime_feature_flags set enabled=false where flag_key='admin_shorts_silence'");
    await expect(insert()).rejects.toThrow('SILENCE_TEST_STOPPED');
  });
  it('bounds total admitted jobs', async () => {
    await insert(); await insert(); await expect(insert()).rejects.toThrow('SILENCE_TEST_UNAVAILABLE');
  });
  it('does not consume a slot on transaction rollback', async () => {
    await db.exec('begin'); await insert(); await db.exec('rollback');
    expect((await db.query('select admitted_jobs from shorts_mvp.silence_test_releases')).rows).toEqual([{admitted_jobs:0}]);
  });
  it('allows progress updates but rejects retargeting/owner/opt-in changes', async () => {
    const id=(await insert()).rows[0].id;
    await db.exec(`update shorts_mvp.video_jobs set status='rendering' where id='${id}'`);
    for (const change of [`user_id='${user}'`, 'silence_test_release_id=null', "batch_job_queue='other'", "template_snapshot='{}'"]) {
      await expect(db.exec(`update shorts_mvp.video_jobs set ${change} where id='${id}'`)).rejects.toThrow('SILENCE_TEST_IDENTITY_IMMUTABLE');
    }
  });
  it('requires an owned, pinned administrator output for editing', async () => {
    const id=(await insert()).rows[0].id;
    await db.exec(`insert into shorts_mvp.generated_shorts values('${release}','${id}','${admin}')`);
    await db.exec(`insert into shorts_mvp.editor_render_requests(short_id,user_id,release_id,release_channel) values('${release}','${admin}','${release}','canary')`);
    await expect(db.exec(`insert into shorts_mvp.editor_render_requests(short_id,user_id,release_id,release_channel) values('${release}','${user}','${release}','canary')`)).rejects.toThrow('SILENCE_TEST_EDITOR_BINDING_INVALID');
  });
  it('does not expose the registry or guard to browser roles', async () => {
    for (const role of ['anon','authenticated']) {
      const result=await db.query(`select has_table_privilege('${role}','shorts_mvp.silence_test_releases','SELECT') as allowed, has_function_privilege('${role}','shorts_mvp.assert_silence_test_job(shorts_mvp.video_jobs)','EXECUTE') as callable`);
      expect(result.rows).toEqual([{allowed:false,callable:false}]);
    }
  });
});
