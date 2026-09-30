import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '../test-tools/node_modules/@electric-sql/pglite/dist/index.js';

test('SNS DB admission is admin-only and leaves public admission intact',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create schema shorts_mvp; create role anon; create role authenticated; create role service_role;
 create table shorts_mvp.app_users(id uuid primary key,is_admin boolean);
 create table shorts_mvp.video_jobs(user_id uuid,language_test_release_id uuid,initial_editor_release_id uuid,template_snapshot jsonb,template_id text,subtitle_template_id text,batch_target_key text,batch_target_release_id text,batch_job_definition text,batch_job_queue text);
 create table shorts_mvp.language_test_settings(singleton boolean,enabled boolean,release_id uuid,public_rollout_percent int);
 create table shorts_mvp.language_test_releases(id uuid,registry jsonb,verified_at timestamptz,verification jsonb);
 create table shorts_mvp.editor_releases(id uuid,git_sha text,worker_image_digest text,font_manifest_sha256 text,status text,staging_verified_at timestamptz,ui_version int,document_version int,render_spec_version int,caption_render_spec_version int);`);
 const old=fs.readFileSync(new URL('../supabase/migrations/202609150001_language_public_and_guide.sql',import.meta.url),'utf8').match(/create or replace function shorts_mvp.assert_language_test_job[\s\S]*?end; \$\$;/)[0];
 await db.exec(old);
 const before=(await db.query("select pg_get_functiondef('shorts_mvp.assert_language_test_job(shorts_mvp.video_jobs)'::regprocedure) body")).rows[0].body;
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/202609300001_sns_admin_generation.sql',import.meta.url),'utf8'));
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/202609300002_sns_release_identity.sql',import.meta.url),'utf8'));
 const after=(await db.query("select pg_get_functiondef('shorts_mvp.assert_language_test_job(shorts_mvp.video_jobs)'::regprocedure) body")).rows[0].body;
 assert.equal(after.replace(/  if p_job.language_test_release_id='8af2c7e6[\s\S]*?  end if;\n/,''),before);
 const admin='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222',publicId='33333333-3333-4333-8333-333333333333',sns='8af2c7e6-5421-4e93-9671-b0e8bb41de8a';
 await db.query('insert into shorts_mvp.app_users values ($1,true),($2,false)',[admin,user]);
 await db.query('insert into shorts_mvp.language_test_settings values(true,true,$1,100)',[publicId]);
 const target=(sns)=>({releaseId:sns?'sns-template-test':'language-public-test',jobDefinitionArn:'arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-language-test-'+(sns?'sns-':'')+'test:1',jobQueueArn:'arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-language-test-production',workerSourceGitSha:'a'.repeat(40),imageUri:'repository@sha256:'+'b'.repeat(64),fontManifestSha256:'c'.repeat(64)});
 for(const id of [publicId,sns]){
  await db.query("insert into shorts_mvp.language_test_releases values($1,$2,now(),jsonb_build_object('kind','sns_admin_generation_only'))",[id,JSON.stringify({lanes:{legacy_project:{current:target(id===sns)}}})]);
  await db.query("insert into shorts_mvp.editor_releases values($1,$2,$3,$4,'canary_ready',now(),3,3,4,4)",[id,'a'.repeat(40),'sha256:'+'b'.repeat(64),'c'.repeat(64)]);
 }
 await db.query("update shorts_mvp.language_test_releases set verification='{}' where id=$1",[publicId]);
 const job=(id,uid=admin)=>({user_id:uid,language_test_release_id:id,initial_editor_release_id:id,template_snapshot:id===sns?{snsTemplateVersion:1}:{},template_id:'white-yellow',subtitle_template_id:null,batch_target_key:'legacy_project',batch_target_release_id:target(id===sns).releaseId,batch_job_definition:target(id===sns).jobDefinitionArn,batch_job_queue:target(id===sns).jobQueueArn});
 const check=(j)=>db.query('select shorts_mvp.assert_language_test_job(jsonb_populate_record(null::shorts_mvp.video_jobs,$1::jsonb))',[JSON.stringify(j)]);
 await check(job(sns)); await check(job(publicId,user)); await check(job(publicId));
 await assert.rejects(check(job(sns,user)),/SNS_TEMPLATE_ADMIN_ONLY/);
 await assert.rejects(check({...job(sns),template_snapshot:{}}),/SNS_TEMPLATE_CONTEXT_MISMATCH/);
 await assert.rejects(check({...job(publicId),template_snapshot:{snsTemplateVersion:1}}),/SNS_TEMPLATE_UNAVAILABLE/);
 await assert.rejects(check({...job(sns),batch_job_definition:target(false).jobDefinitionArn}),/SNS_TEMPLATE_TARGET_MISMATCH/);
 await db.exec('update shorts_mvp.language_test_settings set public_rollout_percent=0');
 await check(job(sns)); await check(job(publicId));
 await assert.rejects(check(job(publicId,user)),/LANGUAGE_PUBLIC_DISABLED/);
 const beta='8dc98fc0-a5bb-411f-9cc6-0e8dc28648ca';
 const publicMigration=fs.readFileSync(new URL('../supabase/migrations/202609300004_sns_public_beta.sql',import.meta.url),'utf8');
 await db.exec(publicMigration.match(/create or replace function shorts_mvp.assert_sns_template_job[\s\S]*?end; \$\$;/)[0]);
 await db.query('insert into shorts_mvp.language_test_releases select $1,registry,verified_at,verification from shorts_mvp.language_test_releases where id=$2',[beta,sns]);
 await db.query('insert into shorts_mvp.editor_releases select $1,git_sha,worker_image_digest,font_manifest_sha256,status,staging_verified_at,ui_version,document_version,render_spec_version,caption_render_spec_version from shorts_mvp.editor_releases where id=$2',[beta,sns]);
 const betaJob={...job(sns,user),language_test_release_id:beta,initial_editor_release_id:beta};
 await check(betaJob);
 await assert.rejects(check({...betaJob,user_id:null}),/SNS_TEMPLATE_ADMIN_ONLY/);
 await assert.rejects(check({...betaJob,batch_job_definition:target(false).jobDefinitionArn}),/SNS_TEMPLATE_TARGET_MISMATCH/);
 await assert.rejects(check(job(sns,user)),/SNS_TEMPLATE_ADMIN_ONLY/);
 await db.query('update shorts_mvp.language_test_releases set verified_at=null where id=$1',[sns]);
 await assert.rejects(check(job(sns)),/SNS_TEMPLATE_UNAVAILABLE/); await check(job(publicId));
 }finally{await db.close();}
});
