begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
-- Candidate-only admission. No public flag, receiver, existing row or release pointer changes.
create table shorts_mvp.upload_language_candidates (
  release_id uuid primary key references shorts_mvp.editor_releases(id),
  administrator_id uuid not null references shorts_mvp.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  max_jobs integer not null default 6 check(max_jobs between 1 and 8),
  admitted_jobs integer not null default 0 check(admitted_jobs>=0),
  check(expires_at>created_at and expires_at<=created_at+interval '4 hours'),
  check(admitted_jobs<=max_jobs)
);
alter table shorts_mvp.upload_language_candidates enable row level security;
revoke all on shorts_mvp.upload_language_candidates from public,anon,authenticated;
grant select,insert,update on shorts_mvp.upload_language_candidates to service_role;

-- Existing immutable source, image, font and finalized fifteen-check probe remain mandatory.
create function shorts_mvp.upload_language_project_release(p_job shorts_mvp.video_jobs)
returns jsonb language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare context jsonb:=p_job.template_snapshot->'uploadLanguage'; font text; proof jsonb;
begin
  if p_job.source_type is distinct from 'upload' or p_job.pipeline_version is distinct from 2
    or p_job.is_example or p_job.midform_request is not null
    or p_job.language_test_release_id is not null or p_job.source_language_hint is not null
    or p_job.initial_render_spec_version is distinct from 4
    or p_job.initial_caption_render_spec_version is distinct from 4
    or jsonb_typeof(context) is distinct from 'object'
    or context->'version' is distinct from '1'::jsonb
    or coalesce(context->>'sourceLanguage','') not in ('auto','ko','en','ja')
    or coalesce(context->>'outputLanguage','') not in ('ko','en','ja')
    or context->>'outputLanguage' is distinct from p_job.output_language
    or context->>'releaseId' is distinct from p_job.initial_editor_release_id::text
  then raise exception 'UPLOAD_LANGUAGE_IDENTITY_INVALID'; end if;
  select e.font_manifest_sha256 into font
    from shorts_mvp.upload_language_candidates c
    join shorts_mvp.app_users u on u.id=c.administrator_id and u.is_admin and u.withdrawn_at is null
    join shorts_mvp.editor_releases e on e.id=c.release_id
    where c.release_id=p_job.initial_editor_release_id and c.administrator_id=p_job.user_id
      and p_job.created_at>=c.created_at and p_job.created_at<c.expires_at
    for share of c,u,e;
  if font is null then raise exception 'UPLOAD_LANGUAGE_CANDIDATE_REQUIRED'; end if;
  proof:=shorts_mvp._verified_file_upload_successor_identity(p_job.initial_editor_release_id,font);
  if proof is null then raise exception 'UPLOAD_LANGUAGE_ATTESTATION_REQUIRED'; end if;
  return proof;
end; $$;
revoke all on function shorts_mvp.upload_language_project_release(shorts_mvp.video_jobs) from public,anon,authenticated;
grant execute on function shorts_mvp.upload_language_project_release(shorts_mvp.video_jobs) to service_role;

create function shorts_mvp.admit_upload_language_job() returns trigger
language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
begin
  if new.template_snapshot->'uploadLanguage' is null then return new; end if;
  update shorts_mvp.upload_language_candidates set admitted_jobs=admitted_jobs+1
    where release_id=new.initial_editor_release_id and administrator_id=new.user_id
      and expires_at>clock_timestamp() and admitted_jobs<max_jobs;
  if not found then raise exception 'UPLOAD_LANGUAGE_CANDIDATE_LIMIT'; end if;
  perform shorts_mvp.upload_language_project_release(new);
  return new;
end; $$;
revoke all on function shorts_mvp.admit_upload_language_job() from public,anon,authenticated;
create trigger video_jobs_admit_upload_language before insert on shorts_mvp.video_jobs
  for each row execute function shorts_mvp.admit_upload_language_job();

-- Preserve the existing language guard for every other job; never use a YouTube release for uploads.
do $$ declare body text; anchor text:=E'begin\n'; begin
  body:=pg_get_functiondef('shorts_mvp.enforce_language_request_binding()'::regprocedure);
  if position('LANGUAGE_RELEASE_REQUIRED' in body)=0 or position('upload_language_project_release' in body)>0
    or position(anchor in body)=0 then raise exception 'UPLOAD_LANGUAGE_GUARD_BASELINE_CHANGED'; end if;
  body:=overlay(body placing E'begin\n  if new.template_snapshot->\'uploadLanguage\' is not null then\n    perform shorts_mvp.upload_language_project_release(new);\n    return new;\n  end if;\n' from position(anchor in body) for length(anchor));
  execute body;
end $$;

create function shorts_mvp.preserve_upload_language_identity() returns trigger
language plpgsql security invoker set search_path=shorts_mvp,pg_temp as $$
begin
  if new.template_snapshot->'uploadLanguage' is distinct from old.template_snapshot->'uploadLanguage'
    or (old.template_snapshot->'uploadLanguage' is not null and
      (new.user_id,new.source_type,new.output_language,new.initial_editor_release_id,
       new.pipeline_version,new.initial_render_spec_version,new.initial_caption_render_spec_version,
       new.language_test_release_id,new.source_language_hint,new.created_at,new.is_example,new.midform_request,
       new.template_snapshot->'shortsSilenceRemovalCandidate',new.template_snapshot->'shortsSilenceCandidateId')
      is distinct from
      (old.user_id,old.source_type,old.output_language,old.initial_editor_release_id,
       old.pipeline_version,old.initial_render_spec_version,old.initial_caption_render_spec_version,
       old.language_test_release_id,old.source_language_hint,old.created_at,old.is_example,old.midform_request,
       old.template_snapshot->'shortsSilenceRemovalCandidate',old.template_snapshot->'shortsSilenceCandidateId'))
  then raise exception 'UPLOAD_LANGUAGE_IDENTITY_IMMUTABLE'; end if;
  return new;
end; $$;
revoke all on function shorts_mvp.preserve_upload_language_identity() from public,anon,authenticated;
create trigger video_jobs_preserve_upload_language before update on shorts_mvp.video_jobs
  for each row execute function shorts_mvp.preserve_upload_language_identity();

create function shorts_mvp.enforce_upload_language_editor_binding() returns trigger
language plpgsql security invoker set search_path=shorts_mvp,pg_temp as $$
declare parent shorts_mvp.video_jobs;
begin
  select j.* into parent from shorts_mvp.generated_shorts s
    join shorts_mvp.video_jobs j on j.id=s.job_id where s.id=new.short_id;
  if parent.template_snapshot->'uploadLanguage' is null then return new; end if;
  perform shorts_mvp.upload_language_project_release(parent);
  if new.release_id is distinct from parent.initial_editor_release_id or new.release_channel is distinct from 'canary'
    or not exists(select 1 from shorts_mvp.generated_shorts s where s.id=new.short_id
      and s.user_id=new.user_id and parent.user_id=new.user_id and s.deleted_at is null
      and parent.user_deleted_at is null and s.expires_at>clock_timestamp()
      and s.render_version=new.base_render_version)
  then raise exception 'UPLOAD_LANGUAGE_EDITOR_BINDING_INVALID'; end if;
  return new;
end; $$;
revoke all on function shorts_mvp.enforce_upload_language_editor_binding() from public,anon,authenticated;
create trigger editor_requests_upload_language_binding before insert on shorts_mvp.editor_render_requests
  for each row execute function shorts_mvp.enforce_upload_language_editor_binding();

-- The new candidate marker never matches the public cron's ordinary opt-in branch.
do $$ declare body text; anchor text:=E'      and (j.template_snapshot->\'shortsSilenceRemoval\''; replacement text; begin
  body:=pg_get_functiondef('shorts_mvp.guard_admin_short_silence_task()'::regprocedure);
  if position(anchor in body)=0 or position('upload_language_project_release' in body)>0 then
    raise exception 'UPLOAD_SILENCE_GUARD_BASELINE_CHANGED'; end if;
  replacement:=E'      and ((case when j.source_type=\'upload\' and u.is_admin\n        and j.template_snapshot->\'shortsSilenceRemovalCandidate\'=\'{"version":1,"preset":"aggressive"}\'::jsonb\n        and j.template_snapshot->>\'shortsSilenceCandidateId\'=j.initial_editor_release_id::text\n        then shorts_mvp.upload_language_project_release(j) is not null else false end)\n        or j.template_snapshot->\'shortsSilenceRemoval\'';
  execute replace(body,anchor,replacement);
end $$;
commit;
