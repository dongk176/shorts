begin;

set local lock_timeout = '3s';
set local statement_timeout = '10min';

-- Legacy releases remain NULL. A release becomes a v4 release only when the
-- registrar inserts all three capabilities from one verified probe manifest.
alter table shorts_mvp.editor_releases
  add column if not exists render_spec_version smallint,
  add column if not exists caption_render_spec_version smallint,
  add column if not exists font_manifest_sha256 text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid='shorts_mvp.editor_releases'::regclass
      and conname='editor_releases_render_v4_capabilities_check'
  ) then
    alter table shorts_mvp.editor_releases
      add constraint editor_releases_render_v4_capabilities_check check (
        (
          render_spec_version is null
          and caption_render_spec_version is null
          and font_manifest_sha256 is null
          and document_version <= 3
        ) or (
          render_spec_version = 4
          and caption_render_spec_version = 4
          and font_manifest_sha256 ~ '^[0-9a-f]{64}$'
          and document_version = 3
        )
      ) not valid;
  end if;
end;
$$;

alter table shorts_mvp.editor_releases
  validate constraint editor_releases_render_v4_capabilities_check;

create table if not exists shorts_mvp.editor_release_project_targets (
  release_id uuid not null
    references shorts_mvp.editor_releases(id) on delete cascade,
  target_key text not null
    check (target_key in (
      'legacy_project','source_range','elevenlabs_transcription',
      'subtitle_templates','unified_template_subtitles'
    )),
  batch_target_release_id text not null
    check (batch_target_release_id ~ '^[a-z0-9][a-z0-9._-]{2,127}$'),
  worker_source_git_sha text not null
    check (worker_source_git_sha ~ '^[0-9a-f]{40}$'),
  worker_image_digest text not null
    check (worker_image_digest ~ '^sha256:[0-9a-f]{64}$'),
  job_definition_arn text not null
    check (
      job_definition_arn
        ~ '^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-definition/[A-Za-z0-9_-]+:[1-9][0-9]*$'
    ),
  job_queue_arn text not null
    check (
      job_queue_arn
        ~ '^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-queue/[A-Za-z0-9_-]+$'
    ),
  created_at timestamptz not null default now(),
  primary key (release_id,target_key),
  unique (job_definition_arn)
);

create or replace function shorts_mvp.protect_editor_release_project_target()
returns trigger
language plpgsql
set search_path=shorts_mvp,pg_temp
as $$
begin
  raise exception 'editor release project target identity is immutable';
end;
$$;

drop trigger if exists editor_release_project_targets_protect_identity
  on shorts_mvp.editor_release_project_targets;
create trigger editor_release_project_targets_protect_identity
before update or delete on shorts_mvp.editor_release_project_targets
for each row execute function shorts_mvp.protect_editor_release_project_target();

alter table shorts_mvp.editor_release_project_targets enable row level security;
revoke all on shorts_mvp.editor_release_project_targets from anon,authenticated;
revoke all on shorts_mvp.editor_release_project_targets from service_role;
grant select,insert on shorts_mvp.editor_release_project_targets to service_role;
revoke all on function shorts_mvp.protect_editor_release_project_target()
  from public,anon,authenticated;
grant execute on function shorts_mvp.protect_editor_release_project_target()
  to service_role;

-- The desired public percentage is retained while the kill switch is on so
-- an emergency stop never destroys the reviewed rollout setting. Internal
-- access continues to use the existing candidate/tester channel.
alter table shorts_mvp.editor_release_state
  add column if not exists render_v4_internal_enabled boolean not null default false,
  add column if not exists render_v4_rollout_percent smallint not null default 0,
  add column if not exists render_v4_kill_switch boolean not null default true,
  add column if not exists render_v4_infra_lease_id uuid,
  add column if not exists render_v4_infra_lease_owner text,
  add column if not exists render_v4_infra_lease_expires_at timestamptz;

-- Audit UUIDs do not encode insert order, and now() is fixed at transaction
-- start. Keep the monotonic v4 transition order on a dedicated sequence and a
-- nullable metadata-only column. Adding an identity/default to the shared audit
-- table would backfill every historical audit row and take a long exclusive
-- lock during the production migration.
create sequence if not exists
  shorts_mvp.editor_render_v4_audit_event_sequence
  as bigint
  increment by 1
  minvalue 1
  maxvalue 9223372036854775807
  start with 1
  cache 1
  no cycle;

alter table shorts_mvp.admin_audit_logs
  add column if not exists render_v4_event_sequence bigint;

revoke all on sequence shorts_mvp.editor_render_v4_audit_event_sequence
  from public,anon,authenticated,service_role;
grant usage,select on sequence
  shorts_mvp.editor_render_v4_audit_event_sequence to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid='shorts_mvp.editor_release_state'::regclass
      and conname='editor_release_state_render_v4_rollout_check'
  ) then
    alter table shorts_mvp.editor_release_state
      add constraint editor_release_state_render_v4_rollout_check check (
        render_v4_rollout_percent in (0,5,25,100)
      ) not valid;
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid='shorts_mvp.editor_release_state'::regclass
      and conname='editor_release_state_render_v4_infra_lease_check'
  ) then
    alter table shorts_mvp.editor_release_state
      add constraint editor_release_state_render_v4_infra_lease_check check (
        (
          render_v4_infra_lease_id is null
          and render_v4_infra_lease_owner is null
          and render_v4_infra_lease_expires_at is null
        ) or (
          render_v4_infra_lease_id is not null
          and render_v4_infra_lease_owner
            ~ '^stage-b:(bootstrap|rotation|lockdown):[0-9a-f]{40}$'
          and render_v4_infra_lease_expires_at is not null
        )
      ) not valid;
  end if;
end;
$$;

alter table shorts_mvp.editor_release_state
  validate constraint editor_release_state_render_v4_rollout_check,
  validate constraint editor_release_state_render_v4_infra_lease_check;

-- New jobs opt in only after worker C is current. Existing jobs remain NULL
-- and therefore stay on the legacy renderer contract.
alter table shorts_mvp.video_jobs
  add column if not exists initial_render_spec_version smallint,
  add column if not exists initial_caption_render_spec_version smallint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid='shorts_mvp.video_jobs'::regclass
      and conname='video_jobs_initial_render_spec_versions_check'
  ) then
    alter table shorts_mvp.video_jobs
      add constraint video_jobs_initial_render_spec_versions_check check (
        (
          initial_render_spec_version is null
          and initial_caption_render_spec_version is null
        ) or (
          initial_render_spec_version = 4
          and initial_caption_render_spec_version = 4
        )
      ) not valid;
  end if;
end;
$$;

alter table shorts_mvp.video_jobs
  validate constraint video_jobs_initial_render_spec_versions_check;

-- The initial worker output is authoritative for both the first rendered
-- video and the first editor open. Semantic v4 validation belongs in the
-- application/worker schema; the database only rejects non-object JSON.
alter table shorts_mvp.generated_shorts
  add column if not exists initial_render_spec jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid='shorts_mvp.generated_shorts'::regclass
      and conname='generated_shorts_initial_render_spec_object_check'
  ) then
    alter table shorts_mvp.generated_shorts
      add constraint generated_shorts_initial_render_spec_object_check check (
        initial_render_spec is null
        or jsonb_typeof(initial_render_spec)='object'
      ) not valid;
  end if;
end;
$$;

alter table shorts_mvp.generated_shorts
  validate constraint generated_shorts_initial_render_spec_object_check;

create or replace function shorts_mvp.protect_editor_release_identity()
returns trigger
language plpgsql
set search_path=shorts_mvp,pg_temp
as $$
begin
  if new.git_sha is distinct from old.git_sha
    or new.ui_version is distinct from old.ui_version
    or new.document_version is distinct from old.document_version
    or new.worker_image_digest is distinct from old.worker_image_digest
    or new.production_job_definition_arn
      is distinct from old.production_job_definition_arn
    or new.subtitle_editing_capable
      is distinct from old.subtitle_editing_capable
    or new.render_spec_version
      is distinct from old.render_spec_version
    or new.caption_render_spec_version
      is distinct from old.caption_render_spec_version
    or new.font_manifest_sha256
      is distinct from old.font_manifest_sha256
  then
    raise exception 'editor release identity is immutable';
  end if;
  return new;
end;
$$;

revoke all on function shorts_mvp.protect_editor_release_identity()
  from public,anon,authenticated;
grant execute on function shorts_mvp.protect_editor_release_identity()
  to service_role;

-- This resolver is service-role only. It centralizes the release decision so
-- callers cannot independently reinterpret the kill switch or rollout bucket.
create or replace function shorts_mvp.resolve_initial_render_v4_release(
  p_user_id uuid,
  p_batch_target_key text,
  p_batch_target_release_id text,
  p_job_definition_arn text,
  p_job_queue_arn text,
  p_worker_image_digest text,
  p_worker_source_git_sha text
)
returns table (
  release_id uuid,
  release_channel text,
  render_spec_version smallint,
  caption_render_spec_version smallint,
  font_manifest_sha256 text,
  release_worker_image_digest text,
  editor_production_job_definition_arn text
)
language plpgsql
volatile
security definer
set search_path=shorts_mvp,pg_temp
as $$
begin
  -- Linearize a successful v4 admission with emergency stop, runtime stop,
  -- and infrastructure lease acquisition. These shared row locks live until
  -- the caller's job-creation transaction commits. The web calls this resolver
  -- immediately before INSERT so emergency stop is delayed only by the final
  -- atomic job/reservation writes, not by earlier validation work.
  perform 1
  from shorts_mvp.editor_release_state state
  join shorts_mvp.runtime_feature_flags runtime
    on runtime.flag_key='editor_rendering_v2'
  where state.singleton
    and runtime.enabled
    and not state.render_v4_kill_switch
    and not (
      state.render_v4_infra_lease_id is not null
      and state.render_v4_infra_lease_expires_at > clock_timestamp()
    )
  for share of state,runtime;

  if not found then
    return;
  end if;

  return query
  with release_state as (
    select state.*,
      (
        ('x' || substr(md5(p_user_id::text || ':editor-render-v4'),1,8))
          ::bit(32)::bigint % 100
      )::smallint as rollout_bucket
    from shorts_mvp.editor_release_state state
    where state.singleton
      and not state.render_v4_kill_switch
      and not (
        state.render_v4_infra_lease_id is not null
        and state.render_v4_infra_lease_expires_at > clock_timestamp()
      )
  ), eligible as (
    select
      candidate.id as release_id,
      'canary'::text as release_channel,
      candidate.render_spec_version,
      candidate.caption_render_spec_version,
      candidate.font_manifest_sha256,
      candidate.worker_image_digest as release_worker_image_digest,
      candidate.production_job_definition_arn
        as editor_production_job_definition_arn,
      0 as priority
    from release_state state
    join shorts_mvp.editor_release_testers tester
      on tester.user_id=p_user_id and tester.enabled
    join shorts_mvp.editor_releases candidate
      on candidate.id=state.candidate_release_id
    join shorts_mvp.editor_release_project_targets project_target
      on project_target.release_id=candidate.id
      and project_target.target_key=p_batch_target_key
      and project_target.batch_target_release_id=p_batch_target_release_id
      and project_target.job_definition_arn=p_job_definition_arn
      and project_target.job_queue_arn=p_job_queue_arn
      and project_target.worker_image_digest=p_worker_image_digest
      and project_target.worker_source_git_sha=p_worker_source_git_sha
    where state.canary_enabled
      and state.render_v4_internal_enabled
      and candidate.render_spec_version=4
      and candidate.caption_render_spec_version=4
      and candidate.font_manifest_sha256 is not null
      and candidate.status in ('canary_ready','canary_active','approved')
      and candidate.staging_verified_at is not null
      and candidate.worker_image_digest=project_target.worker_image_digest
      and candidate.git_sha=project_target.worker_source_git_sha

    union all

    select
      stable.id as release_id,
      'stable'::text as release_channel,
      stable.render_spec_version,
      stable.caption_render_spec_version,
      stable.font_manifest_sha256,
      stable.worker_image_digest as release_worker_image_digest,
      stable.production_job_definition_arn
        as editor_production_job_definition_arn,
      1 as priority
    from release_state state
    join shorts_mvp.editor_releases stable
      on stable.id=state.stable_release_id
    join shorts_mvp.editor_release_project_targets project_target
      on project_target.release_id=stable.id
      and project_target.target_key=p_batch_target_key
      and project_target.batch_target_release_id=p_batch_target_release_id
      and project_target.job_definition_arn=p_job_definition_arn
      and project_target.job_queue_arn=p_job_queue_arn
      and project_target.worker_image_digest=p_worker_image_digest
      and project_target.worker_source_git_sha=p_worker_source_git_sha
    where state.public_enabled
      and state.render_v4_rollout_percent > state.rollout_bucket
      and stable.status='stable'
      and stable.promoted_at is not null
      and stable.render_spec_version=4
      and stable.caption_render_spec_version=4
      and stable.font_manifest_sha256 is not null
      and stable.worker_image_digest=project_target.worker_image_digest
      and stable.git_sha=project_target.worker_source_git_sha
  )
  select
    eligible.release_id,
    eligible.release_channel,
    eligible.render_spec_version,
    eligible.caption_render_spec_version,
    eligible.font_manifest_sha256,
    eligible.release_worker_image_digest,
    eligible.editor_production_job_definition_arn
  from eligible
  order by eligible.priority
  limit 1;
end;
$$;

revoke all on function shorts_mvp.resolve_initial_render_v4_release(
  uuid,text,text,text,text,text,text
)
  from public,anon,authenticated;
grant execute on function shorts_mvp.resolve_initial_render_v4_release(
  uuid,text,text,text,text,text,text
)
  to service_role;

comment on column shorts_mvp.editor_releases.render_spec_version is
  'Immutable verified render specification capability; NULL for legacy releases and 4 for v4.';
comment on column shorts_mvp.editor_releases.caption_render_spec_version is
  'Immutable verified caption render specification capability; NULL for legacy releases and 4 for v4.';
comment on column shorts_mvp.editor_releases.font_manifest_sha256 is
  'Immutable lowercase SHA-256 of the exact verified Linux worker font manifest; NULL for legacy releases.';
comment on column shorts_mvp.editor_release_state.render_v4_infra_lease_id is
  'Crash-safe Stage B infrastructure lease UUID; NULL when no AWS execution owns the release state.';
comment on column shorts_mvp.editor_release_state.render_v4_infra_lease_owner is
  'Exact stage-b phase and Git SHA owner for the renewable infrastructure lease.';
comment on column shorts_mvp.editor_release_state.render_v4_infra_lease_expires_at is
  'Database-clock expiry for the renewable Stage B infrastructure lease.';
comment on column shorts_mvp.admin_audit_logs.render_v4_event_sequence is
  'Dedicated monotonic order for new serialized render-v4 transitions; NULL for unrelated and historical audit rows.';
comment on column shorts_mvp.editor_release_state.render_v4_internal_enabled is
  'Enables v4 only for existing editor release testers on the candidate channel; default false.';
comment on column shorts_mvp.editor_release_state.render_v4_rollout_percent is
  'Desired deterministic public v4 rollout percentage: 0, 5, 25, or 100.';
comment on column shorts_mvp.editor_release_state.render_v4_kill_switch is
  'Emergency v4 stop checked before internal and public rollout; default true (stopped).';
comment on column shorts_mvp.video_jobs.initial_render_spec_version is
  'Initial render contract selected at job creation; legacy NULL, v4 opt-in is exactly 4.';
comment on column shorts_mvp.video_jobs.initial_caption_render_spec_version is
  'Initial caption render contract paired with initial_render_spec_version; legacy NULL, v4 is exactly 4.';
comment on column shorts_mvp.generated_shorts.initial_render_spec is
  'Authoritative v4 title/layout specification generated for the first render and first editor open; legacy NULL.';
comment on table shorts_mvp.editor_release_project_targets is
  'Immutable five-lane initial-render Batch identities registered from the same verified editor release digest and source SHA.';

commit;
