-- Public launch is a separate, initially OFF gate. Keep the persisted identifier
-- for compatibility; intermediate percentages are no longer accepted.
begin;
select pg_advisory_xact_lock(hashtextextended('language_test_admission',0));
alter table shorts_mvp.language_test_settings
  add column if not exists public_rollout_percent integer not null default 0;
alter table shorts_mvp.language_test_settings_audit
  add column if not exists public_rollout_percent integer;
-- Initial deployment must remain private, including installations with an older rollout.
update shorts_mvp.language_test_settings set public_rollout_percent=0,updated_at=now() where singleton;
alter table shorts_mvp.language_test_settings
  drop constraint if exists language_test_settings_public_rollout_percent_check;
alter table shorts_mvp.language_test_settings
  add constraint language_test_settings_public_rollout_percent_check
  check (public_rollout_percent in (0,100));

create table shorts_mvp.language_guide_views (
  user_id uuid primary key references shorts_mvp.app_users(id) on delete cascade,
  status text not null check (status in ('dismissed','completed')),
  updated_at timestamptz not null default now()
);
alter table shorts_mvp.language_guide_views enable row level security;
revoke all on shorts_mvp.language_guide_views from public,anon,authenticated;
grant select,insert,update on shorts_mvp.language_guide_views to service_role;

create or replace function shorts_mvp.assert_language_test_job(p_job shorts_mvp.video_jobs)
returns void language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare r record; t jsonb;
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('language_test_admission',0));
  perform singleton from shorts_mvp.language_test_settings where singleton for share;
  if not exists(
    select 1 from shorts_mvp.app_users u
    join shorts_mvp.language_test_settings s on s.singleton
    where u.id=p_job.user_id and (u.is_admin or s.public_rollout_percent=100)
  ) then
    raise exception 'LANGUAGE_PUBLIC_DISABLED';
  end if;
  select l.*,e.git_sha,e.worker_image_digest,e.font_manifest_sha256,e.status,e.staging_verified_at
    into r from shorts_mvp.language_test_settings s
    join shorts_mvp.language_test_releases l on l.id=s.release_id
    join shorts_mvp.editor_releases e on e.id=l.id
    where s.singleton and s.enabled and l.id=p_job.language_test_release_id
      and l.verified_at is not null and e.ui_version=3 and e.document_version=3
      and e.render_spec_version=4 and e.caption_render_spec_version=4 for share of s,l,e;
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
-- A new translated job must carry the registered language release, including
-- requests from older clients that omit the internal feature marker.
create function shorts_mvp.enforce_language_request_binding() returns trigger
language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
begin
  if new.output_language<>'ko' and new.language_test_release_id is null then
    raise exception 'LANGUAGE_RELEASE_REQUIRED';
  end if;
  return new;
end; $$;
revoke all on function shorts_mvp.enforce_language_request_binding() from public,anon,authenticated;
create trigger video_jobs_language_request_binding before insert on shorts_mvp.video_jobs
  for each row execute function shorts_mvp.enforce_language_request_binding();
commit;
