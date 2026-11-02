-- Dedicated metadata registry. Admission remains off until exact runtime verification.
create table shorts_mvp.midform_releases (
  id uuid primary key references shorts_mvp.editor_releases(id),
  registry jsonb not null check (jsonb_typeof(registry)='object'),
  editor_job_queue_arn text not null,
  verified_at timestamptz,
  verification jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table shorts_mvp.midform_releases enable row level security;
revoke all on shorts_mvp.midform_releases from public,anon,authenticated;
grant select,insert,update on shorts_mvp.midform_releases to service_role;
alter table shorts_mvp.video_jobs add column midform_release_id uuid references shorts_mvp.midform_releases(id);
-- Additive, private metadata. Existing table ownership/RLS and retention apply.
alter table shorts_mvp.video_jobs
  add column if not exists midform_request jsonb;
alter table shorts_mvp.generated_shorts
  add column if not exists midform_document jsonb;
alter table shorts_mvp.video_jobs
  add constraint video_jobs_midform_request_check check (
    midform_request is null or coalesce((
      jsonb_typeof(midform_request) = 'object'
      and midform_request->>'version' = '1'
      and (midform_request->>'targetSeconds')::integer = 0
      and midform_release_id is not null
      and initial_editor_release_id=midform_release_id
      and language_test_release_id is null
      and not is_example
      and source_type in ('upload','youtube') and planned_short_count = 1
    ),false)
  );
alter table shorts_mvp.generated_shorts
  add constraint generated_shorts_midform_document_check check (
    midform_document is null or coalesce((
      jsonb_typeof(midform_document) = 'object'
      and midform_document->>'version' = '1'
      and jsonb_typeof(midform_document->'rows') = 'array'
      and (midform_document->>'duration')::numeric between 0.01 and 1200.1
    ),false)
  );

alter table shorts_mvp.generated_shorts
  drop constraint generated_shorts_pending_edit_request_check,
  add constraint generated_shorts_pending_edit_request_check check (
    (pending_edit_snapshot is null and pending_edit_request_id is null)
    or (pending_edit_snapshot is not null and jsonb_typeof(pending_edit_snapshot)='object'
      and pending_edit_request_id is null and (
        pending_edit_snapshot->'version' is null or pending_edit_snapshot->'version'='1'::jsonb))
    or (pending_edit_snapshot is not null and jsonb_typeof(pending_edit_snapshot)='object'
      and pending_edit_request_id is not null and (
        (pending_edit_snapshot->>'version')::smallint in (2,3)
        or coalesce((pending_edit_snapshot->>'version'='4'
          and pending_edit_snapshot->>'kind'='midform' and midform_document is not null),false)))
  );

create function shorts_mvp.assert_midform_job(p_job shorts_mvp.video_jobs)
returns void language plpgsql security invoker set search_path=shorts_mvp,pg_temp as $$
declare r record; t jsonb;
begin
  if not exists(select 1 from shorts_mvp.app_users where id=p_job.user_id and is_admin) then
    raise exception 'MIDFORM_ADMIN_REQUIRED';
  end if;
  select m.*,e.git_sha,e.worker_image_digest,e.font_manifest_sha256,e.status,e.staging_verified_at
    into r from shorts_mvp.midform_releases m join shorts_mvp.editor_releases e on e.id=m.id
    where m.id=p_job.midform_release_id and m.verified_at is not null for share of m,e;
  if not found or r.status not in ('canary_ready','canary_active','approved') or r.staging_verified_at is null
    or p_job.midform_request is distinct from '{"version":1,"targetSeconds":0}'::jsonb
    or p_job.initial_editor_release_id is distinct from r.id
    or p_job.pipeline_version is distinct from 2 or p_job.initial_render_spec_version is distinct from 4 or p_job.initial_caption_render_spec_version is distinct from 4
    or p_job.planned_short_count is distinct from 1 or p_job.is_example
  then raise exception 'MIDFORM_RELEASE_UNAVAILABLE'; end if;
  if p_job.source_type='youtube' then
    t:=r.registry->'lanes'->p_job.batch_target_key->'current';
    if t is null or p_job.batch_target_release_id is distinct from t->>'releaseId'
      or p_job.batch_job_definition is distinct from t->>'jobDefinitionArn'
      or p_job.batch_job_queue is distinct from t->>'jobQueueArn'
      or r.git_sha is distinct from t->>'workerSourceGitSha'
      or r.worker_image_digest is distinct from split_part(t->>'imageUri','@',2)
      or r.font_manifest_sha256 is distinct from t->>'fontManifestSha256'
      or coalesce(t->>'releaseId','') not like 'midform-%'
    then raise exception 'MIDFORM_TARGET_MISMATCH'; end if;
  elsif p_job.source_type<>'upload' then raise exception 'MIDFORM_SOURCE_INVALID'; end if;
end; $$;
revoke all on function shorts_mvp.assert_midform_job(shorts_mvp.video_jobs) from public,anon,authenticated;
grant execute on function shorts_mvp.assert_midform_job(shorts_mvp.video_jobs) to service_role;

do $$ declare body text;
begin
  body:=pg_get_functiondef('shorts_mvp.enforce_project_target_successor_admission()'::regprocedure);
  if position('assert_midform_job' in body)>0 or position(E'begin\n' in body)=0 then
    raise exception 'Unrecognized project admission guard';
  end if;
  body:=overlay(body placing E'begin\n  if new.midform_request is not null then\n    perform shorts_mvp.assert_midform_job(new);\n    return new;\n  end if;\n' from position(E'begin\n' in body) for 6);
  execute body;
end; $$;

create function shorts_mvp.enforce_midform_identity() returns trigger
language plpgsql security invoker set search_path=shorts_mvp,pg_temp as $$
begin
  if new.midform_request is distinct from old.midform_request
    or new.midform_release_id is distinct from old.midform_release_id
    or (old.midform_request is not null and (new.user_id is distinct from old.user_id
      or new.is_example or new.initial_editor_release_id is distinct from old.initial_editor_release_id))
  then raise exception 'MIDFORM_IDENTITY_IMMUTABLE'; end if;
  return new;
end; $$;
revoke all on function shorts_mvp.enforce_midform_identity() from public,anon,authenticated;
create trigger video_jobs_midform_identity before update on shorts_mvp.video_jobs
for each row execute function shorts_mvp.enforce_midform_identity();

alter table shorts_mvp.video_jobs add constraint video_jobs_midform_pair_check check (
  (midform_request is null) = (midform_release_id is null)
);
