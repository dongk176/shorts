begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
-- Durable evidence retains editing for existing projects after a receiver changes.
-- Empty until an operator records the actual completed production acceptance results.
create table shorts_mvp.upload_language_public_releases (
 release_id uuid primary key references shorts_mvp.editor_releases(id),
 recorded_by uuid not null references shorts_mvp.app_users(id),
 verified_at timestamptz not null default clock_timestamp(),
 evidence jsonb not null default '{}'::jsonb
);
alter table shorts_mvp.upload_language_public_releases enable row level security;
revoke all on shorts_mvp.upload_language_public_releases from public,anon,authenticated;
grant select,insert on shorts_mvp.upload_language_public_releases to service_role;
create function shorts_mvp.guard_upload_language_public_release() returns trigger
language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare runtime shorts_mvp.file_upload_release_checks; proof jsonb; language text;
begin
 if tg_op<>'INSERT' then raise exception 'UPLOAD_LANGUAGE_PUBLIC_PROOF_IMMUTABLE';end if;
 if not exists(select 1 from shorts_mvp.app_users where id=new.recorded_by and is_admin and withdrawn_at is null)
 then raise exception 'UPLOAD_LANGUAGE_PUBLIC_ADMIN_REQUIRED';end if;
 perform 1 from shorts_mvp.file_upload_release_checks order by check_key for share;
 select * into runtime from shorts_mvp.file_upload_release_checks where check_key='runtime_identity';
 if not found or not runtime.passed or runtime.successor is not null
   or runtime.details->>'releaseId' is distinct from new.release_id::text
   or (select count(*) from shorts_mvp.file_upload_release_checks)<>9
   or exists(select 1 from shorts_mvp.file_upload_release_checks c where not c.passed
     or c.details->>'releaseId' is distinct from new.release_id::text
     or c.details->>'sourceGitSha' is distinct from runtime.details->>'sourceGitSha'
     or c.details->>'workerImageDigest' is distinct from runtime.details->>'workerImageDigest'
     or c.details->>'fontManifestSha256' is distinct from runtime.details->>'fontManifestSha256')
 then raise exception 'UPLOAD_LANGUAGE_PUBLIC_ACCEPTANCE_REQUIRED';end if;
 proof:=shorts_mvp._verified_file_upload_successor_identity(new.release_id,runtime.details->>'fontManifestSha256');
 if proof is null or proof->>'sourceGitSha' is distinct from runtime.details->>'sourceGitSha'
   or proof->>'workerImageDigest' is distinct from runtime.details->>'workerImageDigest'
   or runtime.details->'multilingualUpload'->'version' is distinct from '1'::jsonb
   or runtime.details->'multilingualUpload'->>'phase' is distinct from 'verified'
   or runtime.details->'multilingualUpload'->>'sourceGitSha' is distinct from proof->>'sourceGitSha'
   or runtime.details->'multilingualUpload'->>'workerImageDigest' is distinct from proof->>'workerImageDigest'
   or jsonb_typeof(runtime.details->'multilingualUpload'->'cases') is distinct from 'array'
 then raise exception 'UPLOAD_LANGUAGE_PUBLIC_ROUNDTRIP_REQUIRED';end if;
 foreach language in array array['ko','en','ja'] loop
  if not exists(select 1 from jsonb_array_elements(runtime.details->'multilingualUpload'->'cases') c
   where c->>'language'=language and c->'generated'='true'::jsonb and c->'silenceRemoved'='true'::jsonb
    and c->'restored'='true'::jsonb and c->'edited'='true'::jsonb and c->'rendered'='true'::jsonb)
  then raise exception 'UPLOAD_LANGUAGE_PUBLIC_ROUNDTRIP_REQUIRED';end if;
 end loop;
 new.evidence:=runtime.details;new.verified_at:=clock_timestamp();return new;
end;$$;
revoke all on function shorts_mvp.guard_upload_language_public_release() from public,anon,authenticated;
create trigger upload_language_public_proof_guard before insert or update or delete on shorts_mvp.upload_language_public_releases
 for each row execute function shorts_mvp.guard_upload_language_public_release();

-- Extend only the release lookup; preserve every immutable context/attestation guard.
do $$ declare body text; old_lookup text; new_lookup text;begin
 body:=pg_get_functiondef('shorts_mvp.upload_language_project_release(shorts_mvp.video_jobs)'::regprocedure);
 old_lookup:=$old$  select e.font_manifest_sha256 into font
    from shorts_mvp.upload_language_candidates c
    join shorts_mvp.app_users u on u.id=c.administrator_id and u.is_admin and u.withdrawn_at is null
    join shorts_mvp.editor_releases e on e.id=c.release_id
    where c.release_id=p_job.initial_editor_release_id and c.administrator_id=p_job.user_id
      and p_job.created_at>=c.created_at and p_job.created_at<c.expires_at
    for share of c,u,e;$old$;
 new_lookup:=$new$  select e.font_manifest_sha256 into font from shorts_mvp.editor_releases e
    where e.id=p_job.initial_editor_release_id and (
      exists(select 1 from shorts_mvp.upload_language_candidates c join shorts_mvp.app_users u
        on u.id=c.administrator_id and u.is_admin and u.withdrawn_at is null
        where c.release_id=e.id and c.administrator_id=p_job.user_id
          and p_job.created_at>=c.created_at and p_job.created_at<c.expires_at)
      or exists(select 1 from shorts_mvp.upload_language_public_releases p
        where p.release_id=e.id and p_job.created_at>=p.verified_at
          and not (p_job.template_snapshot ?| array['shortsSilenceRemovalCandidate','shortsSilenceCandidateId'])))
    for share of e;$new$;
 if position(old_lookup in body)=0 then raise exception 'UPLOAD_LANGUAGE_PUBLIC_BASELINE_CHANGED';end if;
 execute replace(body,old_lookup,new_lookup);
end $$;

create or replace function shorts_mvp.admit_upload_language_job() returns trigger
language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare runtime shorts_mvp.file_upload_release_checks;
begin
 if new.template_snapshot->'uploadLanguage' is null then return new;end if;
 select * into runtime from shorts_mvp.file_upload_release_checks where check_key='runtime_identity' for share;
 if runtime.passed and runtime.successor is null and runtime.details->>'releaseId'=new.initial_editor_release_id::text
   and exists(select 1 from shorts_mvp.upload_language_public_releases where release_id=new.initial_editor_release_id)
   and not(new.template_snapshot ?| array['shortsSilenceRemovalCandidate','shortsSilenceCandidateId']) then
  perform shorts_mvp.upload_language_project_release(new);return new;
 end if;
 update shorts_mvp.upload_language_candidates set admitted_jobs=admitted_jobs+1
   where release_id=new.initial_editor_release_id and administrator_id=new.user_id
     and expires_at>clock_timestamp() and admitted_jobs<max_jobs;
 if not found then raise exception 'UPLOAD_LANGUAGE_CANDIDATE_LIMIT';end if;
 perform shorts_mvp.upload_language_project_release(new);return new;
end;$$;
commit;
