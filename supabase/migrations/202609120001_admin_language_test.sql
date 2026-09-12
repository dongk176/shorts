begin;
set local lock_timeout='3s';

-- Additive feature registration. Never update the public editor pointers or
-- the production five-lane registry to enable this experiment.
create table shorts_mvp.language_test_releases (
  id uuid primary key references shorts_mvp.editor_releases(id),
  registry jsonb not null check (registry->>'environment'='production' and registry->>'version'='1'),
  editor_job_queue_arn text not null check (editor_job_queue_arn ~ '^arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-language-test-'),
  verified_at timestamptz,
  verification jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table shorts_mvp.language_test_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  release_id uuid references shorts_mvp.language_test_releases(id),
  updated_at timestamptz not null default now()
);
insert into shorts_mvp.language_test_settings(singleton) values(true);
create table shorts_mvp.language_test_settings_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references shorts_mvp.app_users(id),
  enabled boolean not null,release_id uuid,
  created_at timestamptz not null default now()
);
alter table shorts_mvp.language_test_releases enable row level security;
alter table shorts_mvp.language_test_settings enable row level security;
alter table shorts_mvp.language_test_settings_audit enable row level security;
revoke all on shorts_mvp.language_test_releases,shorts_mvp.language_test_settings,shorts_mvp.language_test_settings_audit from public,anon,authenticated;
grant select,insert,update on shorts_mvp.language_test_releases,shorts_mvp.language_test_settings,shorts_mvp.language_test_settings_audit to service_role;
grant usage,select on sequence shorts_mvp.language_test_settings_audit_id_seq to service_role;

alter table shorts_mvp.video_jobs
  add column source_language_hint text,
  add column language_test_release_id uuid references shorts_mvp.language_test_releases(id),
  add constraint video_jobs_language_test_context check (
    (language_test_release_id is null and source_language_hint is null)
    or (language_test_release_id is not null and source_language_hint is not null
      and source_language_hint in ('auto','ko','en','ja') and output_language in ('ko','en','ja')
      and source_type is not distinct from 'youtube' and pipeline_version is not distinct from 2
      and initial_editor_release_id is not distinct from language_test_release_id
      and initial_render_spec_version is not distinct from 4 and initial_caption_render_spec_version is not distinct from 4)
  ) not valid;
create index video_jobs_language_test_active on shorts_mvp.video_jobs(language_test_release_id,status)
  where language_test_release_id is not null;

create function shorts_mvp.assert_language_test_job(p_job shorts_mvp.video_jobs)
returns void language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare r record; t jsonb;
begin
  if not exists(select 1 from shorts_mvp.app_users where id=p_job.user_id and is_admin) then
    raise exception 'LANGUAGE_TEST_ADMIN_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('language_test_admission',0));
  if exists(select 1 from shorts_mvp.video_jobs where language_test_release_id is not null
    and status not in ('completed','failed','expired','deleted') and id<>p_job.id) then
    raise exception 'LANGUAGE_TEST_BUSY';
  end if;
  select l.*,e.git_sha,e.worker_image_digest,e.font_manifest_sha256,e.status,e.staging_verified_at
    into r from shorts_mvp.language_test_settings s
    join shorts_mvp.language_test_releases l on l.id=s.release_id
    join shorts_mvp.editor_releases e on e.id=l.id
    where s.singleton and s.enabled and l.id=p_job.language_test_release_id
      and l.verified_at is not null for share of s,l,e;
  if not found or r.status not in ('canary_ready','canary_active','approved') or r.staging_verified_at is null then
    raise exception 'LANGUAGE_TEST_UNAVAILABLE';
  end if;
  t:=r.registry->'lanes'->p_job.batch_target_key->'current';
  if t is null or p_job.initial_editor_release_id is distinct from r.id
    or p_job.batch_target_release_id is distinct from t->>'releaseId'
    or p_job.batch_job_definition is distinct from t->>'jobDefinitionArn'
    or p_job.batch_job_queue is distinct from t->>'jobQueueArn'
    or r.git_sha is distinct from t->>'workerSourceGitSha'
    or r.worker_image_digest is distinct from split_part(t->>'imageUri','@',2)
    or r.font_manifest_sha256 is distinct from t->>'fontManifestSha256'
    or coalesce(t->>'jobDefinitionArn','') !~ '^arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-language-test-'
    or coalesce(t->>'jobQueueArn','') !~ '^arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-language-test-'
  then raise exception 'LANGUAGE_TEST_TARGET_MISMATCH'; end if;
end; $$;
revoke all on function shorts_mvp.assert_language_test_job(shorts_mvp.video_jobs) from public,anon,authenticated;
grant execute on function shorts_mvp.assert_language_test_job(shorts_mvp.video_jobs) to service_role;

-- Keep the exact existing stable guard body. Only explicitly marked insertions
-- take the independently attested feature path. No global handoff state changes.
do $$ declare body text;
begin
  body:=pg_get_functiondef('shorts_mvp.enforce_project_target_successor_admission()'::regprocedure);
  if position('assert_language_test_job' in body)>0 then raise exception 'Language guard already installed'; end if;
  if position(E'begin\n' in body)=0 then raise exception 'Unrecognized stable guard'; end if;
  body:=overlay(body placing E'begin\n  if new.language_test_release_id is not null then\n    perform shorts_mvp.assert_language_test_job(new);\n    return new;\n  end if;\n' from position(E'begin\n' in body) for 6);
  execute body;
end $$;

create function shorts_mvp.preserve_language_test_binding() returns trigger
language plpgsql set search_path=shorts_mvp,pg_temp as $$
begin
  if new.language_test_release_id is distinct from old.language_test_release_id
    or new.source_language_hint is distinct from old.source_language_hint
    or (old.language_test_release_id is not null and (
      new.output_language is distinct from old.output_language
      or new.initial_editor_release_id is distinct from old.initial_editor_release_id
      or new.batch_target_release_id is distinct from old.batch_target_release_id
      or new.batch_target_key is distinct from old.batch_target_key
      or new.batch_job_definition is distinct from old.batch_job_definition
      or new.batch_job_queue is distinct from old.batch_job_queue)) then
    raise exception 'LANGUAGE_TEST_BINDING_IMMUTABLE';
  end if;
  return new;
end; $$;
create trigger video_jobs_preserve_language_test_binding before update on shorts_mvp.video_jobs
  for each row execute function shorts_mvp.preserve_language_test_binding();

create function shorts_mvp.preserve_language_test_release() returns trigger
language plpgsql set search_path=shorts_mvp,pg_temp as $$
begin
  if old.verified_at is not null and (new.registry is distinct from old.registry
    or new.editor_job_queue_arn is distinct from old.editor_job_queue_arn
    or new.verified_at is distinct from old.verified_at
    or new.verification is distinct from old.verification) then
    raise exception 'LANGUAGE_TEST_RELEASE_IMMUTABLE';
  end if;
  return new;
end; $$;
create trigger language_test_release_immutable before update on shorts_mvp.language_test_releases
  for each row execute function shorts_mvp.preserve_language_test_release();

-- Pin every subsequent render to the parent, even after admission is OFF.
create function shorts_mvp.enforce_language_test_editor_binding() returns trigger
language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare pinned uuid;
begin
  select j.language_test_release_id into pinned from shorts_mvp.generated_shorts s
    join shorts_mvp.video_jobs j on j.id=s.job_id
    where s.id=new.short_id and s.user_id=new.user_id and j.user_id=new.user_id;
  if pinned is not null then
    if new.release_id is distinct from pinned or new.release_channel<>'canary'
      or not exists(select 1 from shorts_mvp.language_test_releases where id=pinned and verified_at is not null) then
      raise exception 'LANGUAGE_TEST_EDITOR_BINDING_MISMATCH';
    end if;
  elsif exists(select 1 from shorts_mvp.language_test_releases where id=new.release_id) then
    raise exception 'LANGUAGE_TEST_EDITOR_BINDING_MISMATCH';
  end if;
  return new;
end; $$;
create trigger editor_requests_language_test_binding before insert on shorts_mvp.editor_render_requests
  for each row execute function shorts_mvp.enforce_language_test_editor_binding();

-- Translated subtitles retain the chosen template while rendering as basic.
alter table shorts_mvp.generated_shorts drop constraint generated_shorts_subtitle_template_check;
alter table shorts_mvp.generated_shorts add constraint generated_shorts_subtitle_template_check check (
  (subtitle_template_id is null and caption_render_spec is null and (
    subtitle_template_snapshot is null or subtitle_template_snapshot#>>'{translationOutcome,status}'='unavailable'))
  or (subtitle_template_id in ('basic','highlight','pop')
    and jsonb_typeof(subtitle_template_snapshot)='object'
    and subtitle_template_snapshot->>'subtitleTemplateId' is not distinct from subtitle_template_id
    and (caption_render_spec is null or (jsonb_typeof(caption_render_spec)='object' and (
      caption_render_spec->>'templateId' is not distinct from subtitle_template_id
      or coalesce((caption_render_spec->>'templateId'='basic'
        and caption_render_spec->>'schemaVersion'='4'
        and caption_render_spec#>>'{translation,policy}'='translated-basic-v1'
        and caption_render_spec#>>'{translation,sourceLanguage}' ~ '^[a-z]{2,3}(-[a-z]{2,4})?$'
        and caption_render_spec#>>'{translation,outputLanguage}' in ('ko','en','ja')
        and caption_render_spec#>>'{translation,sourceLanguage}'<>caption_render_spec#>>'{translation,outputLanguage}'
        and caption_render_spec->'translation' ? 'requestedTemplateId'
        and caption_render_spec#>>'{translation,requestedTemplateId}' is not distinct from subtitle_template_id),false)
    ))))
  or coalesce((subtitle_template_id is null
    and subtitle_template_snapshot#>>'{translationOutcome,policy}'='translated-basic-v1'
    and subtitle_template_snapshot#>>'{translationOutcome,status}'='ready'
    and caption_render_spec->>'templateId'='basic'
    and caption_render_spec->>'schemaVersion'='4'
    and caption_render_spec#>>'{translation,policy}'='translated-basic-v1'
    and caption_render_spec#>>'{translation,sourceLanguage}' ~ '^[a-z]{2,3}(-[a-z]{2,4})?$'
    and caption_render_spec#>>'{translation,outputLanguage}' in ('ko','en','ja')
    and caption_render_spec#>>'{translation,sourceLanguage}'<>caption_render_spec#>>'{translation,outputLanguage}'
    and caption_render_spec->'translation' ? 'requestedTemplateId'
    and caption_render_spec#>>'{translation,requestedTemplateId}' is null),false)
) not valid;
commit;
