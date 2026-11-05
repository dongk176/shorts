-- Private, bounded QA admission. No changes to public target/state pointers.
set local lock_timeout='2s';
set local statement_timeout='30s';
create table shorts_mvp.silence_test_releases (
  id uuid primary key references shorts_mvp.editor_releases(id),
  administrator_id uuid not null references shorts_mvp.app_users(id),
  enabled boolean not null default false,
  expires_at timestamptz not null,
  max_jobs integer not null default 2 check (max_jobs between 1 and 4),
  admitted_jobs integer not null default 0 check (admitted_jobs between 0 and 4),
  verified_at timestamptz,
  verification jsonb not null default '{}'::jsonb,
  job_queue_arn text not null check (job_queue_arn =
    'arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-editor-test'),
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours')
);
alter table shorts_mvp.silence_test_releases enable row level security;
revoke all on shorts_mvp.silence_test_releases from public,anon,authenticated;
grant select,insert,update on shorts_mvp.silence_test_releases to service_role;
alter table shorts_mvp.video_jobs add column silence_test_release_id uuid
  references shorts_mvp.silence_test_releases(id);

create function shorts_mvp.assert_silence_test_job(p_job shorts_mvp.video_jobs)
returns void language plpgsql security invoker set search_path=shorts_mvp,pg_temp as $$
declare r record; t record; v_state shorts_mvp.editor_release_state%rowtype;
begin
  -- Locks only the private QA row; ordinary submissions do not acquire it.
  select q.*,e.status,e.git_sha,e.worker_image_digest,e.staging_verified_at,
    e.render_spec_version,e.caption_render_spec_version into r
    from shorts_mvp.silence_test_releases q join shorts_mvp.editor_releases e on e.id=q.id
    where q.id=p_job.silence_test_release_id for update of q;
  if not found or not r.enabled or r.verified_at is null or r.expires_at<=clock_timestamp()
    or r.admitted_jobs>=r.max_jobs or r.administrator_id is distinct from p_job.user_id
    or r.status not in ('canary_ready','canary_active','approved')
    or r.staging_verified_at is null or r.render_spec_version<>4 or r.caption_render_spec_version<>4
    or not exists(select 1 from shorts_mvp.app_users where id=p_job.user_id and is_admin)
  then raise exception 'SILENCE_TEST_UNAVAILABLE'; end if;
  select * into v_state from shorts_mvp.editor_release_state where singleton for share;
  if not found or v_state.render_v4_kill_switch
    or (v_state.render_v4_infra_lease_id is not null
      and v_state.render_v4_infra_lease_expires_at>clock_timestamp())
    or not exists(select 1 from shorts_mvp.runtime_feature_flags
      where flag_key='editor_rendering_v2' and enabled)
    or not exists(select 1 from shorts_mvp.runtime_feature_flags
      where flag_key='admin_shorts_silence' and enabled)
  then raise exception 'SILENCE_TEST_STOPPED'; end if;
  -- Upload is deliberately excluded until its isolated receiver is verified.
  if p_job.source_type is distinct from 'youtube' or p_job.pipeline_version is distinct from 2
    or p_job.is_example is distinct from false or p_job.output_language is distinct from 'ko'
    or p_job.custom_template_id is not null or p_job.midform_request is not null
    or p_job.language_test_release_id is not null or p_job.source_language_hint is not null
    or coalesce(p_job.template_snapshot->>'snsTemplateVersion','')<>''
    or p_job.template_snapshot->'shortsSilenceRemoval' is distinct from '{"version":1,"preset":"aggressive"}'::jsonb
    or p_job.initial_editor_release_id is distinct from r.id
    or p_job.initial_render_spec_version is distinct from 4
    or p_job.initial_caption_render_spec_version is distinct from 4
  then raise exception 'SILENCE_TEST_BINDING_INVALID'; end if;
  select * into t from shorts_mvp.editor_release_project_targets
    where release_id=r.id and target_key=p_job.batch_target_key;
  if not found or p_job.batch_target_release_id is distinct from t.batch_target_release_id
    or p_job.batch_job_definition is distinct from t.job_definition_arn
    or p_job.batch_job_queue is distinct from r.job_queue_arn
    or t.worker_source_git_sha is distinct from r.git_sha
    or t.worker_image_digest is distinct from r.worker_image_digest
  then raise exception 'SILENCE_TEST_TARGET_INVALID'; end if;
  update shorts_mvp.silence_test_releases set admitted_jobs=admitted_jobs+1 where id=r.id;
end; $$;
revoke all on function shorts_mvp.assert_silence_test_job(shorts_mvp.video_jobs) from public,anon,authenticated;
grant execute on function shorts_mvp.assert_silence_test_job(shorts_mvp.video_jobs) to service_role;

do $$ declare body text;
begin
  body:=pg_get_functiondef('shorts_mvp.enforce_project_target_successor_admission()'::regprocedure);
  if md5(body)<>'b3ef3b9fac02184c7b96701cee43a449' then
    raise exception 'Admission changed: inspect current production before applying';
  end if;
  body:=overlay(body placing E'begin\n  if new.silence_test_release_id is not null then\n    perform shorts_mvp.assert_silence_test_job(new);\n    return new;\n  end if;\n'
    from position(E'begin\n' in body) for 6);
  execute body;
end; $$;

create function shorts_mvp.enforce_silence_test_identity() returns trigger
language plpgsql security invoker set search_path=shorts_mvp,pg_temp as $$
begin
  if new.silence_test_release_id is distinct from old.silence_test_release_id
    or (old.silence_test_release_id is not null and (
      row(new.user_id,new.source_type,new.pipeline_version,new.is_example,new.output_language,
        new.custom_template_id,new.template_snapshot,new.language_test_release_id,new.midform_request,
        new.initial_editor_release_id,new.initial_render_spec_version,new.initial_caption_render_spec_version,
        new.batch_target_key,new.batch_target_release_id,new.batch_job_definition,new.batch_job_queue)
      is distinct from
      row(old.user_id,old.source_type,old.pipeline_version,old.is_example,old.output_language,
        old.custom_template_id,old.template_snapshot,old.language_test_release_id,old.midform_request,
        old.initial_editor_release_id,old.initial_render_spec_version,old.initial_caption_render_spec_version,
        old.batch_target_key,old.batch_target_release_id,old.batch_job_definition,old.batch_job_queue)))
  then raise exception 'SILENCE_TEST_IDENTITY_IMMUTABLE'; end if;
  return new;
end; $$;
revoke all on function shorts_mvp.enforce_silence_test_identity() from public,anon,authenticated;
create trigger video_jobs_silence_test_identity before update on shorts_mvp.video_jobs
for each row execute function shorts_mvp.enforce_silence_test_identity();

create function shorts_mvp.enforce_silence_test_editor_binding() returns trigger
language plpgsql security invoker set search_path=shorts_mvp,pg_temp as $$
declare pinned uuid;
begin
  select j.silence_test_release_id into pinned from shorts_mvp.generated_shorts s
    join shorts_mvp.video_jobs j on j.id=s.job_id where s.id=new.short_id;
  if pinned is null and not exists(select 1 from shorts_mvp.silence_test_releases where id=new.release_id) then
    return new;
  end if;
  if new.release_id is distinct from pinned or new.release_channel is distinct from 'canary'
    or not exists(select 1 from shorts_mvp.generated_shorts s
      join shorts_mvp.video_jobs j on j.id=s.job_id
      join shorts_mvp.app_users u on u.id=j.user_id
      join shorts_mvp.silence_test_releases r on r.id=j.silence_test_release_id
      where s.id=new.short_id and s.user_id=new.user_id and j.user_id=new.user_id
        and u.is_admin and r.administrator_id=u.id and r.verified_at is not null)
  then raise exception 'SILENCE_TEST_EDITOR_BINDING_INVALID'; end if;
  return new;
end; $$;
revoke all on function shorts_mvp.enforce_silence_test_editor_binding() from public,anon,authenticated;
create trigger editor_requests_silence_test_binding before insert on shorts_mvp.editor_render_requests
for each row execute function shorts_mvp.enforce_silence_test_editor_binding();
