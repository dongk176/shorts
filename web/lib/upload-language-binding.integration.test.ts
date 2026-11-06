import { readFile } from 'node:fs/promises';
import { PGlite } from '../../test-tools/node_modules/@electric-sql/pglite/dist/index.js';
import { afterAll,beforeAll,expect,it } from 'vitest';
let db:PGlite;
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',release='33333333-3333-4333-8333-333333333333',short='44444444-4444-4444-8444-444444444444';
let next=10;const uuid=()=>`55555555-5555-4555-8555-${String(next++).padStart(12,'0')}`;
const snapshot={uploadLanguage:{version:1,sourceLanguage:'auto',outputLanguage:'ja',releaseId:release},shortsSilenceRemovalCandidate:{version:1,preset:'aggressive'},shortsSilenceCandidateId:release};
async function insert(overrides:Record<string,unknown>={}){
 const value={id:uuid(),user_id:owner,source_type:'upload',pipeline_version:2,is_example:false,midform_request:null,language_test_release_id:null,source_language_hint:null,initial_render_spec_version:4,initial_caption_render_spec_version:4,initial_editor_release_id:release,output_language:'ja',template_snapshot:JSON.stringify(snapshot),...overrides};
 const names=Object.keys(value);await db.query(`insert into shorts_mvp.video_jobs(${names.join(',')}) values(${names.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(value));return value.id;
}
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema shorts_mvp;
 create table shorts_mvp.app_users(id uuid primary key,is_admin boolean,withdrawn_at timestamptz);
 create table shorts_mvp.editor_releases(id uuid primary key,font_manifest_sha256 text);
 create table shorts_mvp.video_jobs(id uuid primary key,user_id uuid,source_type text,pipeline_version int,is_example boolean,midform_request jsonb,language_test_release_id uuid,source_language_hint text,initial_render_spec_version int,initial_caption_render_spec_version int,initial_editor_release_id uuid,output_language text,template_snapshot jsonb,created_at timestamptz default clock_timestamp(),user_deleted_at timestamptz);
 create table shorts_mvp.generated_shorts(id uuid primary key,job_id uuid,user_id uuid,deleted_at timestamptz,expires_at timestamptz default clock_timestamp()+interval '1 day',render_version int default 1);
 create table shorts_mvp.editor_render_requests(id uuid,short_id uuid,user_id uuid,release_id uuid,release_channel text,base_render_version int);
 create table shorts_mvp.admin_short_silence_tasks(short_id uuid,job_id uuid,user_id uuid,request_id uuid,state text);
 create table shorts_mvp.silence_test_releases(id uuid,administrator_id uuid,verified_at timestamptz,expires_at timestamptz);
 create table shorts_mvp.test_attestation(enabled boolean);insert into shorts_mvp.test_attestation values(true);
 create function shorts_mvp._verified_file_upload_successor_identity(r uuid,f text) returns jsonb language plpgsql as $$begin
 if not(select enabled from shorts_mvp.test_attestation) then raise exception 'unverified probe';end if;
 return jsonb_build_object('releaseId',r,'fontManifestSha256',f,'sourceGitSha','test-source','workerImageDigest','test-digest');end;$$;
 create function shorts_mvp.enforce_language_request_binding() returns trigger language plpgsql as $$
begin
  if new.output_language<>'ko' and new.language_test_release_id is null then
    raise exception 'LANGUAGE_RELEASE_REQUIRED';
  end if;
  return new;
end;$$;
 create trigger language_guard before insert on shorts_mvp.video_jobs for each row execute function shorts_mvp.enforce_language_request_binding();
 insert into shorts_mvp.app_users values('${owner}',true,null),('${other}',false,null);
 insert into shorts_mvp.editor_releases values('${release}','verified-test-font');`);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261105134650_candidate_language_silence_tasks.sql',import.meta.url),'utf8'));
 await db.exec(`create trigger silence_guard before insert or update on shorts_mvp.admin_short_silence_tasks for each row execute function shorts_mvp.guard_admin_short_silence_task();`);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261105185406_verified_upload_language_binding.sql',import.meta.url),'utf8'));
 await db.exec('alter table shorts_mvp.video_jobs add column silence_test_release_id uuid');
 const silenceMigration=await readFile(new URL('../../supabase/migrations/20261105075326_admin_silence_isolated_admission.sql',import.meta.url),'utf8');
 await db.exec(silenceMigration.slice(silenceMigration.indexOf('create function shorts_mvp.enforce_silence_test_editor_binding()')));
 await db.exec(await readFile(new URL('../../supabase/migrations/20261106135240_silence_upload_editor_binding.sql',import.meta.url),'utf8'));
 // Same verified worker is registered for link and upload QA; this used to reject all upload edits.
 await db.exec(`insert into shorts_mvp.silence_test_releases values('${release}','${owner}',now(),now()+interval '1 hour')`);
 await db.exec(`insert into shorts_mvp.upload_language_candidates(release_id,administrator_id,expires_at) values('${release}','${owner}',clock_timestamp()+interval '1 hour');`);
});
afterAll(async()=>{await db?.close();});
it('rejects mismatched candidates without consuming allowance; preserves ordinary Korean requests',async()=>{
 for(const change of [{user_id:other},{source_type:'youtube'},{output_language:'en'},{initial_render_spec_version:3},{language_test_release_id:release},{source_language_hint:'ja'},{is_example:true},{midform_request:{}},{template_snapshot:JSON.stringify({...snapshot,uploadLanguage:{...snapshot.uploadLanguage,releaseId:other}})}])await expect(insert(change)).rejects.toThrow();
 expect((await db.query<{admitted_jobs:number}>('select admitted_jobs from shorts_mvp.upload_language_candidates')).rows[0].admitted_jobs).toBe(0);
 const publicJob=await insert({user_id:other,output_language:'ko',template_snapshot:JSON.stringify({shortsSilenceRemoval:{version:1,preset:'aggressive'}})});
 const publicShort=uuid();await db.query('insert into shorts_mvp.generated_shorts(id,job_id,user_id) values($1,$2,$3)',[publicShort,publicJob,other]);
 await db.query("insert into shorts_mvp.admin_short_silence_tasks values($1,$2,$3,$4,'processing')",[publicShort,publicJob,other,uuid()]);
 await expect(insert({template_snapshot:'{}'})).rejects.toThrow('LANGUAGE_RELEASE_REQUIRED');
 const id=await insert();await db.query('insert into shorts_mvp.generated_shorts(id,job_id,user_id) values($1,$2,$3)',[short,id,owner]);
 await db.query("insert into shorts_mvp.admin_short_silence_tasks values($1,$2,$3,$4,'processing')",[short,id,owner,short]);
 await expect(db.query("update shorts_mvp.video_jobs set template_snapshot='{}' where id=$1",[id])).rejects.toThrow('UPLOAD_LANGUAGE_IDENTITY_IMMUTABLE');
 await expect(db.query("update shorts_mvp.video_jobs set output_language='en' where id=$1",[id])).rejects.toThrow('UPLOAD_LANGUAGE_IDENTITY_IMMUTABLE');
 await db.query("update shorts_mvp.admin_short_silence_tasks set state='completed' where short_id=$1",[short]);
 await db.exec('begin;update shorts_mvp.upload_language_candidates set max_jobs=1');
 await expect(insert()).rejects.toThrow('UPLOAD_LANGUAGE_CANDIDATE_LIMIT');await db.exec('rollback');
});
it('pins editor requests and retains editing after candidate admission expires',async()=>{
 const render=(id=release,user=owner)=>db.query("insert into shorts_mvp.editor_render_requests values($1,$2,$3,$4,'canary',1)",[uuid(),short,user,id]);
 await expect(render(other)).rejects.toThrow('UPLOAD_LANGUAGE_EDITOR_BINDING_INVALID');await expect(render(release,other)).rejects.toThrow('SILENCE_TEST_EDITOR_BINDING_INVALID');await render();
 await db.exec("update shorts_mvp.upload_language_candidates set expires_at=clock_timestamp()-interval '1 millisecond'");await expect(insert()).rejects.toThrow();await render();
 await db.exec('update shorts_mvp.test_attestation set enabled=false');await expect(render()).rejects.toThrow('unverified probe');await db.exec('update shorts_mvp.test_attestation set enabled=true');
});

it('requires all public roundtrips before nonadmin admission and preserves old project edits after handoff',async()=>{
 await db.exec(`create table shorts_mvp.file_upload_release_checks(check_key text primary key,passed boolean,details jsonb,successor jsonb);`);
 const cases=['ko','en','ja'].map(language=>({language,generated:true,silenceRemoved:true,restored:true,edited:true,rendered:true}));
 const proof={releaseId:release,sourceGitSha:'test-source',workerImageDigest:'test-digest',fontManifestSha256:'verified-test-font',multilingualUpload:{version:1,phase:'verified',sourceGitSha:'test-source',workerImageDigest:'test-digest',cases}};
 for(const key of ['runtime_identity','admin_end_to_end','render_parity','upload_1gb','upload_5gb','source_cleanup','usage_integrity','no_proxy_environment','no_stuck_sessions'])await db.query('insert into shorts_mvp.file_upload_release_checks values($1,true,$2,null)',[key,JSON.stringify(proof)]);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261105191157_verified_public_upload_language_binding.sql',import.meta.url),'utf8'));
 const record=(user=owner)=>db.query('insert into shorts_mvp.upload_language_public_releases(release_id,recorded_by) values($1,$2)',[release,user]);
 await expect(record(other)).rejects.toThrow('UPLOAD_LANGUAGE_PUBLIC_ADMIN_REQUIRED');
 await db.exec("update shorts_mvp.file_upload_release_checks set passed=false where check_key='upload_5gb'");await expect(record()).rejects.toThrow('UPLOAD_LANGUAGE_PUBLIC_ACCEPTANCE_REQUIRED');await db.exec('update shorts_mvp.file_upload_release_checks set passed=true');
 await db.query("update shorts_mvp.file_upload_release_checks set details=$1 where check_key='runtime_identity'",[JSON.stringify({...proof,multilingualUpload:{...proof.multilingualUpload,cases:cases.slice(0,2)}})]);await expect(record()).rejects.toThrow('UPLOAD_LANGUAGE_PUBLIC_ROUNDTRIP_REQUIRED');
 await db.query('update shorts_mvp.file_upload_release_checks set details=$1',[JSON.stringify(proof)]);
 const publicSnapshot={uploadLanguage:snapshot.uploadLanguage,shortsSilenceRemoval:{version:1,preset:'aggressive'}};
 await expect(insert({user_id:other,template_snapshot:JSON.stringify(publicSnapshot)})).rejects.toThrow();
 await record();
 const job=await insert({user_id:other,template_snapshot:JSON.stringify(publicSnapshot)});
 await expect(insert({user_id:other})).rejects.toThrow();
 const id=uuid();await db.query('insert into shorts_mvp.generated_shorts(id,job_id,user_id) values($1,$2,$3)',[id,job,other]);
 await db.query("insert into shorts_mvp.admin_short_silence_tasks values($1,$2,$3,$4,'processing')",[id,job,other,uuid()]);
 await db.exec("update shorts_mvp.file_upload_release_checks set successor='{}'");
 await expect(insert({user_id:other,template_snapshot:JSON.stringify(publicSnapshot)})).rejects.toThrow();
 await db.query("insert into shorts_mvp.editor_render_requests values($1,$2,$3,$4,'canary',1)",[uuid(),id,other,release]);
 await expect(db.exec('delete from shorts_mvp.upload_language_public_releases')).rejects.toThrow('UPLOAD_LANGUAGE_PUBLIC_PROOF_IMMUTABLE');
});
