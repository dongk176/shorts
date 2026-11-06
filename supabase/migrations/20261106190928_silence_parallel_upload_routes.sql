begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
-- Per-release receiver identities retain old sessions and leave the existing
-- public upload receiver / nine global checks untouched.
create table shorts_mvp.silence_upload_routes (
 release_id uuid primary key references shorts_mvp.shorts_silence_routes(release_id),
 administrator_id uuid not null references shorts_mvp.app_users(id),
 receiver_url text not null,
 capacity_function_arn text not null,
 runtime_evidence jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 check(receiver_url ~ ('^https://[a-z0-9]+[.]cloudfront[.]net/silence-upload/'||release_id::text||'$')),
 check(capacity_function_arn ~ '^arn:aws:lambda:ap-northeast-2:181651591905:function:shorts-upload-candidate-[a-z0-9-]+$')
);
create table shorts_mvp.silence_upload_acceptance (
 release_id uuid primary key references shorts_mvp.silence_upload_routes(release_id),
 recorded_by uuid not null references shorts_mvp.app_users(id),
 verified_at timestamptz not null default clock_timestamp(),
 checks jsonb not null,
 languages jsonb not null
);
alter table shorts_mvp.silence_upload_routes enable row level security;
alter table shorts_mvp.silence_upload_acceptance enable row level security;
revoke all on shorts_mvp.silence_upload_routes,shorts_mvp.silence_upload_acceptance from public,anon,authenticated,service_role;
grant select on shorts_mvp.silence_upload_routes,shorts_mvp.silence_upload_acceptance to service_role;

create function shorts_mvp.guard_silence_upload_route() returns trigger
language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare release shorts_mvp.editor_releases;
begin
 if tg_op<>'INSERT' then raise exception 'SILENCE_UPLOAD_ROUTE_IMMUTABLE';end if;
 select * into release from shorts_mvp.editor_releases where id=new.release_id for share;
 if not found or not exists(select 1 from shorts_mvp.app_users where id=new.administrator_id and is_admin and withdrawn_at is null)
   or new.runtime_evidence->>'sourceGitSha' is distinct from release.git_sha
   or new.runtime_evidence->>'workerImageDigest' is distinct from release.worker_image_digest
   or new.runtime_evidence->>'fontManifestSha256' is distinct from release.font_manifest_sha256
   or new.runtime_evidence->>'releaseId' is distinct from new.release_id::text
   or new.runtime_evidence->'noProxyEnvironment' is distinct from 'true'::jsonb
   or new.runtime_evidence->'receiverReady' is distinct from 'true'::jsonb
   or shorts_mvp._verified_file_upload_successor_identity(new.release_id,release.font_manifest_sha256) is null
 then raise exception 'SILENCE_UPLOAD_RUNTIME_IDENTITY_REQUIRED';end if;
 return new;
end;$$;
create trigger silence_upload_route_guard before insert or update or delete on shorts_mvp.silence_upload_routes
 for each row execute function shorts_mvp.guard_silence_upload_route();

create function shorts_mvp.guard_silence_upload_acceptance() returns trigger
language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare route shorts_mvp.silence_upload_routes; key text; language text; evidence jsonb;
begin
 if tg_op<>'INSERT' then raise exception 'SILENCE_UPLOAD_ACCEPTANCE_IMMUTABLE';end if;
 select * into route from shorts_mvp.silence_upload_routes where release_id=new.release_id for share;
 if not found or not exists(select 1 from shorts_mvp.app_users where id=new.recorded_by and is_admin and withdrawn_at is null)
 then raise exception 'SILENCE_UPLOAD_ADMIN_REQUIRED';end if;
 foreach key in array array['admin_end_to_end','render_parity','upload_1gb','upload_5gb','source_cleanup','usage_integrity','runtime_identity','no_proxy_environment','no_stuck_sessions'] loop
  evidence:=new.checks->key;
  if evidence->'passed' is distinct from 'true'::jsonb or coalesce(evidence->>'evidenceId','')=''
    or evidence->>'sourceGitSha' is distinct from route.runtime_evidence->>'sourceGitSha'
    or evidence->>'workerImageDigest' is distinct from route.runtime_evidence->>'workerImageDigest'
    or evidence->>'fontManifestSha256' is distinct from route.runtime_evidence->>'fontManifestSha256'
    or evidence->>'releaseId' is distinct from new.release_id::text
  then raise exception 'SILENCE_UPLOAD_NINE_CHECKS_REQUIRED: %',key;end if;
 end loop;
 foreach language in array array['ko','en','ja'] loop
  evidence:=new.languages->language;
  if evidence->'generated' is distinct from 'true'::jsonb or evidence->'silenceRemoved' is distinct from 'true'::jsonb
    or evidence->'restored' is distinct from 'true'::jsonb or evidence->'edited' is distinct from 'true'::jsonb
    or evidence->'rendered' is distinct from 'true'::jsonb or coalesce(evidence->>'evidenceId','')=''
  then raise exception 'SILENCE_UPLOAD_LANGUAGE_ROUNDTRIP_REQUIRED: %',language;end if;
 end loop;
 new.verified_at:=clock_timestamp();return new;
end;$$;
create trigger silence_upload_acceptance_guard before insert or update or delete on shorts_mvp.silence_upload_acceptance
 for each row execute function shorts_mvp.guard_silence_upload_acceptance();

create function shorts_mvp.assert_silence_upload_job(p_job shorts_mvp.video_jobs,p_admitting boolean)
returns void language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare route shorts_mvp.silence_upload_routes; context jsonb:=p_job.template_snapshot->'uploadLanguage'; verified timestamptz;
begin
 select * into route from shorts_mvp.silence_upload_routes where release_id=p_job.silence_inline_release_id for share;
 if not found or p_job.source_language_hint is not null
   or context->'version' is distinct from '1'::jsonb
   or coalesce(context->>'sourceLanguage','') not in ('auto','ko','en','ja')
   or context->>'outputLanguage' is distinct from p_job.output_language
   or context->>'releaseId' is distinct from route.release_id::text
 then raise exception 'SILENCE_UPLOAD_BINDING_INVALID';end if;
 if p_job.user_id is distinct from route.administrator_id then
  select verified_at into verified from shorts_mvp.silence_upload_acceptance where release_id=route.release_id for share;
  if not found or p_job.created_at<verified then raise exception 'SILENCE_UPLOAD_PUBLIC_ACCEPTANCE_REQUIRED';end if;
 elsif not exists(select 1 from shorts_mvp.app_users where id=p_job.user_id and is_admin and withdrawn_at is null) then
  raise exception 'SILENCE_UPLOAD_ADMIN_REQUIRED';
 end if;
 if p_admitting and (not exists(select 1 from shorts_mvp.runtime_feature_flags where flag_key='file_upload' and enabled)
   or exists(select 1 from shorts_mvp.runtime_feature_flags where flag_key='file_upload_emergency_stop' and enabled)
   or (p_job.user_id is distinct from route.administrator_id and not exists(select 1 from shorts_mvp.runtime_feature_flags where flag_key='file_upload_public' and enabled)))
 then raise exception 'SILENCE_UPLOAD_ADMISSION_STOPPED';end if;
end;$$;

-- Preserve old guards byte-for-byte outside the newly marked branch.
do $$ declare body text; anchor text;begin
 body:=pg_get_functiondef('shorts_mvp.assert_shorts_silence_inline_job(shorts_mvp.video_jobs,boolean)'::regprocedure);
 anchor:=$a$  if p_job.source_type is distinct from 'youtube' or p_job.pipeline_version is distinct from 2$a$;
 if position(anchor in body)=0 then raise exception 'SILENCE_UPLOAD_ASSERTION_BASELINE_CHANGED';end if;
 body:=replace(body,anchor,$a$  if p_job.source_type='upload' then perform shorts_mvp.assert_silence_upload_job(p_job,p_admitting);end if;
  if coalesce(p_job.source_type,'') not in ('youtube','upload') or p_job.pipeline_version is distinct from 2$a$);
 execute body;
 body:=pg_get_functiondef('shorts_mvp.upload_language_project_release(shorts_mvp.video_jobs)'::regprocedure);
 if position(E'begin\n' in body)=0 or position('UPLOAD_LANGUAGE_IDENTITY_INVALID' in body)=0 then raise exception 'SILENCE_UPLOAD_LANGUAGE_BASELINE_CHANGED';end if;
 execute overlay(body placing E'begin\n  if p_job.silence_inline_release_id is not null then\n    perform shorts_mvp.assert_shorts_silence_inline_job(p_job,false);\n    select font_manifest_sha256 into font from shorts_mvp.editor_releases where id=p_job.initial_editor_release_id;\n    proof:=shorts_mvp._verified_file_upload_successor_identity(p_job.initial_editor_release_id,font);\n    if proof is null then raise exception \'UPLOAD_LANGUAGE_ATTESTATION_REQUIRED\';end if;\n    return proof;\n  end if;\n' from position(E'begin\n' in body) for 6);
 body:=pg_get_functiondef('shorts_mvp.admit_upload_language_job()'::regprocedure);
 if position(E'begin\n' in body)=0 or position('UPLOAD_LANGUAGE_CANDIDATE_LIMIT' in body)=0 then raise exception 'SILENCE_UPLOAD_ADMISSION_BASELINE_CHANGED';end if;
 execute overlay(body placing E'begin\n  if new.silence_inline_release_id is not null then\n    perform shorts_mvp.assert_shorts_silence_inline_job(new,true);\n    return new;\n  end if;\n' from position(E'begin\n' in body) for 6);
end $$;
revoke all on function shorts_mvp.guard_silence_upload_route(),shorts_mvp.guard_silence_upload_acceptance(),shorts_mvp.assert_silence_upload_job(shorts_mvp.video_jobs,boolean) from public,anon,authenticated;
grant execute on function shorts_mvp.assert_silence_upload_job(shorts_mvp.video_jobs,boolean) to service_role;
commit;
