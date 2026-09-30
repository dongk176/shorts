import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '../test-tools/node_modules/@electric-sql/pglite/dist/index.js';

test('SNS and community immutable releases preserve public admission and owner checks',async()=>{
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
 // Apply the follow-up release against the existing public generation/editor guards.
 await db.exec(`create table shorts_mvp.editor_render_requests(release_id uuid,release_channel text,short_id uuid,user_id uuid,base_render_version int);
 create function shorts_mvp.enforce_language_test_editor_binding() returns trigger language plpgsql as $$ declare pinned uuid; begin
  if new.release_id in ('406dadcf-f290-4eb8-b82e-a6e8c6b40105'::uuid,'77d3b2de-12a4-4b7d-a134-87170b1d3ecf'::uuid) then
    perform shorts_mvp.assert_sns_editor_request(new); return new;
  end if;
  if pinned is not null then return new; end if;
  return new; end $$;
 alter table shorts_mvp.video_jobs add column id uuid, add column user_deleted_at timestamptz;
 create table shorts_mvp.generated_shorts(id uuid,job_id uuid,user_id uuid,deleted_at timestamptz,expires_at timestamptz,render_version int,template_snapshot jsonb);
 create table shorts_mvp.editor_release_checks(release_id uuid,environment text,check_name text,status text,completed_at timestamptz,details jsonb);`);
 await db.exec(publicMigration.match(/create or replace function shorts_mvp.assert_sns_editor_request[\s\S]*?end; \$\$;/)[0]);
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/202609300005_sns_hook_baseline_release.sql',import.meta.url),'utf8'));
 const nextGeneration='b871796a-f83a-4aed-8d56-bf039de1cdbf',nextEditor='4fbfeeaa-e210-4143-aece-c17029d962a0';
 await db.query('insert into shorts_mvp.language_test_releases select $1,registry,verified_at,verification from shorts_mvp.language_test_releases where id=$2',[nextGeneration,beta]);
 for(const id of [nextGeneration,nextEditor])await db.query('insert into shorts_mvp.editor_releases select $1,git_sha,worker_image_digest,font_manifest_sha256,status,staging_verified_at,ui_version,document_version,render_spec_version,caption_render_spec_version from shorts_mvp.editor_releases where id=$2',[id,beta]);
 const nextJob={...betaJob,language_test_release_id:nextGeneration,initial_editor_release_id:nextGeneration};
 await check(nextJob); await check(betaJob);
 await assert.rejects(check({...nextJob,user_id:null}),/SNS_TEMPLATE_ADMIN_ONLY/);
 await assert.rejects(check({...nextJob,batch_job_definition:target(false).jobDefinitionArn}),/SNS_TEMPLATE_TARGET_MISMATCH/);
 const ordinaryAfter=(await db.query("select pg_get_functiondef('shorts_mvp.assert_language_test_job(shorts_mvp.video_jobs)'::regprocedure) body")).rows[0].body;
 assert.equal(ordinaryAfter,after);
 const jobId='44444444-4444-4444-8444-444444444444',shortId='55555555-5555-4555-8555-555555555555';
 await db.query('insert into shorts_mvp.video_jobs select (jsonb_populate_record(null::shorts_mvp.video_jobs,$1::jsonb)).*',[JSON.stringify({...nextJob,id:jobId})]);
 await db.query("insert into shorts_mvp.generated_shorts values($1,$2,$3,null,now()+interval '1 day',1,'{\"snsTemplateVersion\":1}')",[shortId,jobId,user]);
 const proof={sourceGitSha:'a'.repeat(40),imageDigest:'sha256:'+'b'.repeat(64),fontManifestSha256:'c'.repeat(64),generationReleaseIds:[nextGeneration,beta]};
 await db.query("insert into shorts_mvp.editor_release_checks values($1,'isolated','sns_editor_compatibility','passed',now(),$2)",[nextEditor,JSON.stringify(proof)]);
 const request={release_id:nextEditor,release_channel:'canary',short_id:shortId,user_id:user,base_render_version:1};
 const edit=(value)=>db.query('select shorts_mvp.assert_sns_editor_request(jsonb_populate_record(null::shorts_mvp.editor_render_requests,$1::jsonb))',[JSON.stringify(value)]);
 await edit(request);
 for(const patch of [{user_id:admin},{release_id:publicId},{base_render_version:2},{release_channel:'stable'}])await assert.rejects(edit({...request,...patch}),/SNS_EDITOR_BINDING_MISMATCH/);
 await db.query('update shorts_mvp.video_jobs set language_test_release_id=$1,initial_editor_release_id=$1 where id=$2',[beta,jobId]);
 await edit(request);
 await db.query("update shorts_mvp.editor_release_checks set details=jsonb_set(details,'{imageDigest}','\"wrong\"')");
 await assert.rejects(edit(request),/SNS_EDITOR_BINDING_MISMATCH/);
 // Community adds an admin-only branch while old/public SNS admission remains intact.
 await db.query('update shorts_mvp.editor_release_checks set details=$1 where release_id=$2',[JSON.stringify(proof),nextEditor]);
 const priorSns=(await db.query("select pg_get_functiondef('shorts_mvp.assert_sns_template_job(shorts_mvp.video_jobs)'::regprocedure) body")).rows[0].body;
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/202609300006_community_admin_template.sql',import.meta.url),'utf8'));
 const community='a7db3266-7fc0-4175-a818-39aaff712ad3',communityEditor='601d3d10-62b9-47f2-a34e-78b53ab1ec99';
 const ct={...target(true),releaseId:'sns-template-community-test'};
 await db.query("insert into shorts_mvp.language_test_releases values($1,$2,now(),$3)",[community,JSON.stringify({lanes:{legacy_project:{current:ct}}}),JSON.stringify({kind:"community_admin_generation_only"})]);
 for(const id of [community,communityEditor])await db.query('insert into shorts_mvp.editor_releases select $1,git_sha,worker_image_digest,font_manifest_sha256,status,staging_verified_at,ui_version,document_version,render_spec_version,caption_render_spec_version from shorts_mvp.editor_releases where id=$2',[id,nextEditor]);
 const cj={...nextJob,user_id:admin,language_test_release_id:community,initial_editor_release_id:community,batch_target_release_id:ct.releaseId,template_snapshot:{snsTemplateVersion:1,communityTemplateVersion:1}};
 await check(cj);await check(nextJob);await check(betaJob);await check(job(publicId));
 await assert.rejects(check({...cj,user_id:user}),/COMMUNITY_TEMPLATE_ADMIN_ONLY/);
 for(const patch of [{language_test_release_id:nextGeneration},{template_snapshot:{snsTemplateVersion:1}},{template_snapshot:{snsTemplateVersion:1,communityTemplateVersion:2}}])await assert.rejects(check({...cj,...patch}),/COMMUNITY_TEMPLATE_CONTEXT_MISMATCH/);
 await assert.rejects(check({...cj,batch_target_release_id:target(true).releaseId}),/SNS_TEMPLATE_TARGET_MISMATCH/);
 const afterSns=(await db.query("select pg_get_functiondef('shorts_mvp.assert_sns_template_job(shorts_mvp.video_jobs)'::regprocedure) body")).rows[0].body;
 assert.equal(afterSns.replace(/  if p_job.language_test_release_id='a7db3266[\s\S]*?  end if;\n/,''),priorSns);
 await edit(request);
 const communityProof={...proof,generationReleaseIds:[community]};
 await db.query("insert into shorts_mvp.editor_release_checks values($1,'isolated','sns_editor_compatibility','passed',now(),$2)",[communityEditor,JSON.stringify(communityProof)]);
 await db.query('update shorts_mvp.video_jobs set user_id=$1,language_test_release_id=$2,initial_editor_release_id=$2,template_snapshot=$3 where id=$4',[admin,community,JSON.stringify(cj.template_snapshot),jobId]);
 await db.query('update shorts_mvp.generated_shorts set user_id=$1,template_snapshot=$2 where id=$3',[admin,JSON.stringify(cj.template_snapshot),shortId]);
 const cr={...request,release_id:communityEditor,user_id:admin};await edit(cr);
 await assert.rejects(edit({...cr,release_id:nextEditor}),/SNS_EDITOR_BINDING_MISMATCH/);
 await db.query('update shorts_mvp.app_users set is_admin=false where id=$1',[admin]);
 await assert.rejects(edit(cr),/SNS_EDITOR_BINDING_MISMATCH/);
 await db.query('update shorts_mvp.app_users set is_admin=true where id=$1',[admin]);
 // Heading revision preserves old projects and old in-flight editor requests.
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/202609300007_community_white_heading.sql',import.meta.url),'utf8'));
 const cg2='0641d236-5e76-467e-95f3-bf695e6d6083',ce2='11a62875-b24a-4874-9794-4aac13b0c305';
 await db.query('insert into shorts_mvp.language_test_releases select $1,registry,verified_at,verification from shorts_mvp.language_test_releases where id=$2',[cg2,community]);
 for(const id of [cg2,ce2])await db.query('insert into shorts_mvp.editor_releases select $1,git_sha,worker_image_digest,font_manifest_sha256,status,staging_verified_at,ui_version,document_version,render_spec_version,caption_render_spec_version from shorts_mvp.editor_releases where id=$2',[id,communityEditor]);
 await db.query("insert into shorts_mvp.editor_release_checks values($1,'isolated','sns_editor_compatibility','passed',now(),$2)",[ce2,JSON.stringify({...communityProof,generationReleaseIds:[community,cg2]})]);
 await check(cj);await check({...cj,language_test_release_id:cg2,initial_editor_release_id:cg2});
 await check(nextJob);await check(betaJob);await check(job(publicId));
 await edit(cr);await edit({...cr,release_id:ce2});
 await db.query('update shorts_mvp.video_jobs set language_test_release_id=$1,initial_editor_release_id=$1 where id=$2',[cg2,jobId]);
 await edit({...cr,release_id:ce2});
 await assert.rejects(edit(cr),/SNS_EDITOR_BINDING_MISMATCH/); // Old image was never attested for new generation.
 await assert.rejects(check({...cj,user_id:user,language_test_release_id:cg2,initial_editor_release_id:cg2}),/COMMUNITY_TEMPLATE_ADMIN_ONLY/);
 await assert.rejects(check({...cj,language_test_release_id:null}),/COMMUNITY_TEMPLATE_CONTEXT_MISMATCH/);
 await db.query('update shorts_mvp.app_users set is_admin=false where id=$1',[admin]);
 await assert.rejects(edit({...cr,release_id:ce2}),/SNS_EDITOR_BINDING_MISMATCH/);
 await db.query('update shorts_mvp.app_users set is_admin=true where id=$1',[admin]);
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/202609300008_community_board_name.sql',import.meta.url),'utf8'));
 const cg3='1ce342d0-cf2d-41b4-961b-f3abd9f4e336',ce3='242f96a3-fe3b-4f20-a006-3c6559d98573';
 await db.query('insert into shorts_mvp.language_test_releases select $1,registry,verified_at,verification from shorts_mvp.language_test_releases where id=$2',[cg3,community]);
 for(const id of [cg3,ce3])await db.query('insert into shorts_mvp.editor_releases select $1,git_sha,worker_image_digest,font_manifest_sha256,status,staging_verified_at,ui_version,document_version,render_spec_version,caption_render_spec_version from shorts_mvp.editor_releases where id=$2',[id,communityEditor]);
 await db.query("insert into shorts_mvp.editor_release_checks values($1,'isolated','sns_editor_compatibility','passed',now(),$2)",[ce3,JSON.stringify({...communityProof,generationReleaseIds:[community,cg2,cg3]})]);
 for(const id of [community,cg2,cg3]) {
  await check({...cj,language_test_release_id:id,initial_editor_release_id:id});
  await assert.rejects(check({...cj,user_id:user,language_test_release_id:id,initial_editor_release_id:id}),/COMMUNITY_TEMPLATE_ADMIN_ONLY/);
  await db.query('update shorts_mvp.video_jobs set language_test_release_id=$1,initial_editor_release_id=$1 where id=$2',[id,jobId]);
  await edit({...cr,release_id:ce3});
 }
 await assert.rejects(edit({...cr,release_id:ce2}),/SNS_EDITOR_BINDING_MISMATCH/);
 await check(nextJob);await check(betaJob);await check(job(publicId));
 // Public community enables only the new verified generation/editor; old requests keep their gates.
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/202609300009_community_public.sql',import.meta.url),'utf8'));
 const cg4='46d7f96b-7e16-4fa6-920f-b3c915cad8e8',ce4='d1bb4c9d-f055-4cbe-bdbd-318e51ffdf33';
 await db.query('insert into shorts_mvp.language_test_releases select $1,registry,verified_at,$3 from shorts_mvp.language_test_releases where id=$2',[cg4,community,JSON.stringify({kind:'community_public_generation'})]);
 for(const id of [cg4,ce4])await db.query('insert into shorts_mvp.editor_releases select $1,git_sha,worker_image_digest,font_manifest_sha256,status,staging_verified_at,ui_version,document_version,render_spec_version,caption_render_spec_version from shorts_mvp.editor_releases where id=$2',[id,communityEditor]);
 await db.query("insert into shorts_mvp.editor_release_checks values($1,'isolated','sns_editor_compatibility','passed',now(),$2)",[ce4,JSON.stringify({...communityProof,generationReleaseIds:[community,cg2,cg3,cg4]})]);
 const publicCommunity={...cj,user_id:user,language_test_release_id:cg4,initial_editor_release_id:cg4};
 await check(publicCommunity);await check({...publicCommunity,user_id:admin});
 await assert.rejects(check({...publicCommunity,user_id:null}),/COMMUNITY_TEMPLATE_ADMIN_ONLY/);
 await assert.rejects(check({...publicCommunity,batch_job_definition:target(false).jobDefinitionArn}),/SNS_TEMPLATE_TARGET_MISMATCH/);
 for(const id of [community,cg2,cg3]) await assert.rejects(check({...publicCommunity,language_test_release_id:id,initial_editor_release_id:id}),/COMMUNITY_TEMPLATE_ADMIN_ONLY/);
 await db.query('update shorts_mvp.video_jobs set user_id=$1 where id=$2',[user,jobId]);
 await db.query('update shorts_mvp.generated_shorts set user_id=$1 where id=$2',[user,shortId]);
 const publicEdit={...cr,release_id:ce4,user_id:user};
 for(const id of [community,cg2,cg3,cg4]) {
  await db.query('update shorts_mvp.video_jobs set language_test_release_id=$1,initial_editor_release_id=$1 where id=$2',[id,jobId]);
  await edit(publicEdit);
  for(const patch of [{user_id:admin},{base_render_version:2},{release_channel:'stable'},{release_id:ce3}])await assert.rejects(edit({...publicEdit,...patch}),/SNS_EDITOR_BINDING_MISMATCH/);
 }
 // Color-only revision preserves both public releases and all previous ownership checks.
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/202610010001_community_heading_contrast.sql',import.meta.url),'utf8'));
 const cg5='8b0a6b0f-ab5d-43dd-afce-b3a2409b59b9',ce5='ca57c1ae-c841-4f44-835a-f566a3c097c1';
 await db.query('insert into shorts_mvp.language_test_releases select $1,registry,verified_at,verification from shorts_mvp.language_test_releases where id=$2',[cg5,cg4]);
 for(const id of [cg5,ce5])await db.query('insert into shorts_mvp.editor_releases select $1,git_sha,worker_image_digest,font_manifest_sha256,status,staging_verified_at,ui_version,document_version,render_spec_version,caption_render_spec_version from shorts_mvp.editor_releases where id=$2',[id,ce4]);
 await db.query("insert into shorts_mvp.editor_release_checks values($1,'isolated','sns_editor_compatibility','passed',now(),$2)",[ce5,JSON.stringify({...communityProof,generationReleaseIds:[community,cg2,cg3,cg4,cg5]})]);
 await check(publicCommunity);
 const contrastJob={...publicCommunity,language_test_release_id:cg5,initial_editor_release_id:cg5};
 await check(contrastJob);
 await assert.rejects(check({...contrastJob,user_id:null}),/COMMUNITY_TEMPLATE_ADMIN_ONLY/);
 await assert.rejects(check({...contrastJob,batch_job_definition:target(false).jobDefinitionArn}),/SNS_TEMPLATE_TARGET_MISMATCH/);
 for(const id of [community,cg2,cg3])await assert.rejects(check({...contrastJob,language_test_release_id:id,initial_editor_release_id:id}),/COMMUNITY_TEMPLATE_ADMIN_ONLY/);
 const contrastEdit={...publicEdit,release_id:ce5};
 for(const id of [community,cg2,cg3,cg4,cg5]){
  await db.query('update shorts_mvp.video_jobs set language_test_release_id=$1,initial_editor_release_id=$1 where id=$2',[id,jobId]);
  await edit(contrastEdit);
  for(const patch of [{user_id:admin},{base_render_version:2},{release_channel:'stable'}])await assert.rejects(edit({...contrastEdit,...patch}),/SNS_EDITOR_BINDING_MISMATCH/);
 }
 await assert.rejects(edit(publicEdit),/SNS_EDITOR_BINDING_MISMATCH/); // Old editor was never attested for this generation.
 await db.query("update shorts_mvp.editor_release_checks set details=jsonb_set(details,'{imageDigest}','\"wrong\"') where release_id=$1",[ce5]);
 await assert.rejects(edit(contrastEdit),/SNS_EDITOR_BINDING_MISMATCH/);
 await db.query('update shorts_mvp.video_jobs set language_test_release_id=$1,initial_editor_release_id=$1 where id=$2',[cg4,jobId]);
 await edit(publicEdit);
 await db.query("update shorts_mvp.editor_release_checks set details=jsonb_set(details,'{imageDigest}','\"wrong\"') where release_id=$1",[ce4]);
 await assert.rejects(edit(publicEdit),/SNS_EDITOR_BINDING_MISMATCH/);
 await db.query('update shorts_mvp.language_test_releases set verified_at=null where id=$1',[cg4]);
 await assert.rejects(check(publicCommunity),/SNS_TEMPLATE_UNAVAILABLE/);
 await check(nextJob);await check(betaJob);await check(job(publicId));
 await db.query('update shorts_mvp.language_test_releases set verified_at=null where id=$1',[sns]);
 await assert.rejects(check(job(sns)),/SNS_TEMPLATE_UNAVAILABLE/); await check(job(publicId));
 }finally{await db.close();}
});
