import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '../test-tools/node_modules/@electric-sql/pglite/dist/index.js';
const fixture = new URL('./fixtures/ytdlp-recovery-20261125/',import.meta.url);
const read = n => JSON.parse(fs.readFileSync(new URL(n,fixture),'utf8'));
const {ids,old,registrations,editors}=read('identities.json');
const baseline=read('baseline-releases.json');
const functions=read('baseline-functions.json');
const font='1da578de91943f1299bb48e33649264dc748f89356879702817ceab38668beff';
// Synthetic proofs below test guard semantics only; none are production attestations.
test('extraction recovery preserves old bindings and rejects unverified or mismatched new requests',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create schema shorts_mvp;
 create table shorts_mvp.app_users(id uuid primary key,is_admin boolean);
 create table shorts_mvp.video_jobs(id uuid primary key,user_id uuid,language_test_release_id uuid,initial_editor_release_id uuid,template_snapshot jsonb,template_id text,subtitle_template_id text,batch_target_key text,batch_target_release_id text,batch_job_definition text,batch_job_queue text,user_deleted_at timestamptz);
 create table shorts_mvp.language_test_settings(singleton boolean,enabled boolean,release_id uuid,public_rollout_percent int);
 create table shorts_mvp.language_test_releases(id uuid primary key,registry jsonb,verified_at timestamptz,verification jsonb);
 create table shorts_mvp.editor_releases(id uuid primary key,git_sha text,worker_image_digest text,font_manifest_sha256 text,status text,staging_verified_at timestamptz,ui_version int,document_version int,render_spec_version int,caption_render_spec_version int);
 create table shorts_mvp.generated_shorts(id uuid primary key,job_id uuid,user_id uuid,deleted_at timestamptz,expires_at timestamptz,render_version int,template_snapshot jsonb);
 create table shorts_mvp.editor_release_checks(release_id uuid,environment text,check_name text,status text,completed_at timestamptz,details jsonb);
 create table shorts_mvp.editor_render_requests(release_id uuid,release_channel text,short_id uuid,user_id uuid,base_render_version int);`);
 for (const f of functions) await db.exec(f.definition);
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261125015857_ytdlp_recovery_specialized_bindings.sql',import.meta.url),'utf8'));
 await db.exec('create trigger guard before insert on shorts_mvp.editor_render_requests for each row execute function shorts_mvp.enforce_language_test_editor_binding()');
 const admin='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
 await db.query('insert into shorts_mvp.app_users values($1,true),($2,false)',[admin,user]);
 async function release(id,sha,digest){ await db.query("insert into shorts_mvp.editor_releases values($1,$2,$3,$4,'canary_ready',now(),3,3,4,4)",[id,sha,digest,font]); }
 for(const r of baseline.releases){await release(r.id,r.git_sha,r.worker_image_digest);await db.query('insert into shorts_mvp.language_test_releases values($1,$2,now(),$3)',[r.id,JSON.stringify(r.language.registry),JSON.stringify(r.language.verification)]);}
 for(const r of baseline.editors){await release(r.id,r.git_sha,r.worker_image_digest);await db.query("insert into shorts_mvp.editor_release_checks values($1,'isolated','sns_editor_compatibility','passed',now(),$2)",[r.id,JSON.stringify(r.details)]);}
 for(const kind of ['language','sns','community']){
  const r=registrations[kind];await release(ids[kind],r.source,r.digest);
  const proof={kind:kind==='community'?'community_public_generation':'yt-dlp-recovery',sourceGitSha:r.source,imageDigest:r.digest,component:{batchStatus:'SUCCEEDED'},snsCopyAndEditor:{passed:true},renderParity:{passed:true},probe:{batchStatus:'SUCCEEDED',gitSha:r.source,workerImageDigest:r.digest,fontManifestSha256:font}};
  await db.query('insert into shorts_mvp.language_test_releases values($1,$2,now(),$3)',[ids[kind],JSON.stringify(r.registry),JSON.stringify(proof)]);
 }
 await db.query('insert into shorts_mvp.language_test_settings values(true,true,$1,100)',[ids.language]);
 const check=j=>db.query('select shorts_mvp.assert_language_test_job(jsonb_populate_record(null::shorts_mvp.video_jobs,$1::jsonb))',[JSON.stringify(j)]);
 const makeJob=(kind,id,registry,lane='legacy_project')=>{const t=registry.lanes[lane].current;return {user_id:user,language_test_release_id:id,initial_editor_release_id:id,template_snapshot:kind==='language'?{}:{snsTemplateVersion:1,...(kind==='community'?{communityTemplateVersion:1}:{})},template_id:'white-yellow',subtitle_template_id:null,batch_target_key:lane,batch_target_release_id:t.releaseId,batch_job_definition:t.jobDefinitionArn,batch_job_queue:t.jobQueueArn};};
 for(const kind of ['language','sns','community'])for(const lane of Object.keys(registrations[kind].registry.lanes)){
  const j=makeJob(kind,ids[kind],registrations[kind].registry,lane);await check(j);
  for(const patch of [{user_id:null},{initial_editor_release_id:ids.language===j.initial_editor_release_id?ids.sns:ids.language},{batch_job_definition:'wrong'},{batch_job_queue:'wrong'},{batch_target_release_id:'wrong'}]) await assert.rejects(check({...j,...patch}));
 }
 for(const kind of ['sns','community']){
  const r=baseline.releases.find(x=>x.id===old[kind]);await check(makeJob(kind,r.id,r.language.registry));
  for(const path of ['{component,batchStatus}','{renderParity,passed}','{probe,workerImageDigest}']){
   const before=(await db.query('select verification from shorts_mvp.language_test_releases where id=$1',[ids[kind]])).rows[0].verification;
   await db.query("update shorts_mvp.language_test_releases set verification=jsonb_set(verification,$2::text[],'\"wrong\"'::jsonb) where id=$1",[ids[kind],path]);
   await assert.rejects(check(makeJob(kind,ids[kind],registrations[kind].registry)),/SNS_TEMPLATE_UNAVAILABLE/);
   await db.query('update shorts_mvp.language_test_releases set verification=$2 where id=$1',[ids[kind],JSON.stringify(before)]);
  }
 }
 const jobId='44444444-4444-4444-8444-444444444444',shortId='55555555-5555-4555-8555-555555555555';
 for(const kind of ['sns','community']){
  const er=editors[kind+'_editor'];await release(er.id,er.source,er.digest);
  const details={sourceGitSha:er.source,imageDigest:er.digest,fontManifestSha256:font,unifiedTemplateEditorVersion:1,generationReleaseIds:[ids[kind],...baseline.editors.find(r=>r.id===old[kind+'_editor']).details.generationReleaseIds]};
  await db.query("insert into shorts_mvp.editor_release_checks values($1,'isolated','sns_editor_compatibility','passed',now(),$2)",[er.id,JSON.stringify(details)]);
  const j={...makeJob(kind,ids[kind],registrations[kind].registry),id:jobId};
  await db.query('insert into shorts_mvp.video_jobs select (jsonb_populate_record(null::shorts_mvp.video_jobs,$1::jsonb)).*',[JSON.stringify(j)]);
  await db.query("insert into shorts_mvp.generated_shorts values($1,$2,$3,null,now()+interval '1 day',1,$4)",[shortId,jobId,user,JSON.stringify(j.template_snapshot)]);
  const req={release_id:er.id,release_channel:'canary',short_id:shortId,user_id:user,base_render_version:1};
  const edit=r=>db.query('insert into shorts_mvp.editor_render_requests select (jsonb_populate_record(null::shorts_mvp.editor_render_requests,$1::jsonb)).*',[JSON.stringify(r)]);
  await edit(req);
  for(const patch of [{release_id:old[kind+'_editor']},{release_id:ids[kind==='sns'?'community_editor':'sns_editor']},{user_id:admin},{base_render_version:2},{release_channel:'stable'}])await assert.rejects(edit({...req,...patch}));
  await db.query('update shorts_mvp.video_jobs set language_test_release_id=$1,initial_editor_release_id=$1',[old[kind]]);
  await edit(req);await edit({...req,release_id:old[kind+'_editor']});
  for(const path of ['{imageDigest}','{unifiedTemplateEditorVersion}','{generationReleaseIds}']){
   await db.query("update shorts_mvp.editor_release_checks set details=jsonb_set(details,$2::text[],'\"wrong\"'::jsonb) where release_id=$1",[er.id,path]);
   await assert.rejects(edit(req),/SNS_EDITOR_BINDING_MISMATCH/);
   await db.query('update shorts_mvp.editor_release_checks set details=$2 where release_id=$1',[er.id,JSON.stringify(details)]);
  }
  await db.exec('delete from shorts_mvp.video_jobs;delete from shorts_mvp.generated_shorts;delete from shorts_mvp.editor_render_requests');
 }
 } finally{await db.close()}
});
