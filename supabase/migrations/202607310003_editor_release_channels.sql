begin;

create table if not exists shorts_mvp.editor_releases (
  id uuid primary key default gen_random_uuid(),
  git_sha text not null check (git_sha ~ '^[0-9a-f]{40}$'),
  ui_version integer not null check (ui_version >= 2),
  document_version smallint not null check (document_version >= 2),
  worker_image_digest text not null
    check (worker_image_digest ~ '^sha256:[0-9a-f]{64}$'),
  production_job_definition_arn text not null
    check (
      production_job_definition_arn
        ~ '^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-definition/shorts-mvp-editor-release-[a-z0-9-]+:[1-9][0-9]*$'
    ),
  status text not null default 'built'
    check (status in (
      'built','staging_verified','canary_ready','canary_active',
      'approved','stable','rejected','rolled_back'
    )),
  previous_release_id uuid
    references shorts_mvp.editor_releases(id) on delete set null,
  created_by_user_id uuid
    references shorts_mvp.app_users(id) on delete set null,
  approved_by_user_id uuid
    references shorts_mvp.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  staging_verified_at timestamptz,
  canary_started_at timestamptz,
  approved_at timestamptz,
  promoted_at timestamptz,
  rolled_back_at timestamptz,
  unique (git_sha,worker_image_digest),
  check (
    (status in ('staging_verified','canary_ready','canary_active','approved','stable')
      and staging_verified_at is not null)
    or status in ('built','rejected','rolled_back')
  ),
  check (
    (status in ('approved','stable') and approved_at is not null)
    or status not in ('approved','stable')
  ),
  check (
    (status='stable' and promoted_at is not null)
    or status<>'stable'
  )
);

create table if not exists shorts_mvp.editor_release_state (
  singleton boolean primary key default true check (singleton),
  stable_release_id uuid
    references shorts_mvp.editor_releases(id) on delete restrict,
  previous_stable_release_id uuid
    references shorts_mvp.editor_releases(id) on delete restrict,
  candidate_release_id uuid
    references shorts_mvp.editor_releases(id) on delete restrict,
  public_enabled boolean not null default false,
  canary_enabled boolean not null default false,
  updated_by_user_id uuid
    references shorts_mvp.app_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (not public_enabled or stable_release_id is not null),
  check (not canary_enabled or candidate_release_id is not null),
  check (
    stable_release_id is null
    or candidate_release_id is null
    or stable_release_id<>candidate_release_id
  )
);

insert into shorts_mvp.editor_release_state (
  singleton,stable_release_id,previous_stable_release_id,
  candidate_release_id,public_enabled,canary_enabled
) values (true,null,null,null,false,false)
on conflict (singleton) do nothing;

create table if not exists shorts_mvp.editor_release_testers (
  user_id uuid primary key
    references shorts_mvp.app_users(id) on delete cascade,
  enabled boolean not null default true,
  created_by_user_id uuid
    references shorts_mvp.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shorts_mvp.editor_release_checks (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null
    references shorts_mvp.editor_releases(id) on delete cascade,
  environment text not null
    check (environment in ('isolated','production_canary')),
  check_name text not null
    check (char_length(check_name) between 2 and 100),
  status text not null
    check (status in ('pending','running','passed','failed')),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details)='object'),
  artifact_uri text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (release_id,environment,check_name),
  check (
    (status in ('passed','failed') and completed_at is not null)
    or status in ('pending','running')
  )
);

alter table shorts_mvp.editor_render_requests
  add column if not exists release_id uuid
    references shorts_mvp.editor_releases(id) on delete restrict,
  add column if not exists release_channel text
    check (release_channel in ('stable','canary')),
  add column if not exists worker_image_digest text
    check (
      worker_image_digest is null
      or worker_image_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
  add column if not exists batch_job_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname='editor_render_requests_release_check'
      and conrelid='shorts_mvp.editor_render_requests'::regclass
  ) then
    alter table shorts_mvp.editor_render_requests
      add constraint editor_render_requests_release_check check (
        (
          release_id is null
          and release_channel is null
        ) or (
          release_id is not null
          and release_channel is not null
        )
      );
  end if;
end;
$$;

create index if not exists editor_releases_status_created_idx
  on shorts_mvp.editor_releases(status,created_at desc);
create index if not exists editor_release_checks_release_status_idx
  on shorts_mvp.editor_release_checks(release_id,status);
create index if not exists editor_render_requests_release_created_idx
  on shorts_mvp.editor_render_requests(release_id,created_at desc)
  where release_id is not null;

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
  then
    raise exception 'editor release identity is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists editor_releases_protect_identity
  on shorts_mvp.editor_releases;
create trigger editor_releases_protect_identity
before update on shorts_mvp.editor_releases
for each row execute function shorts_mvp.protect_editor_release_identity();

create or replace function shorts_mvp.protect_editor_render_request_release()
returns trigger
language plpgsql
set search_path=shorts_mvp,pg_temp
as $$
begin
  if new.release_id is distinct from old.release_id
    or new.release_channel is distinct from old.release_channel
    or (
      old.worker_image_digest is not null
      and new.worker_image_digest is distinct from old.worker_image_digest
    )
  then
    raise exception 'editor render request release is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists editor_render_requests_protect_release
  on shorts_mvp.editor_render_requests;
create trigger editor_render_requests_protect_release
before update on shorts_mvp.editor_render_requests
for each row execute function shorts_mvp.protect_editor_render_request_release();

revoke all on function shorts_mvp.protect_editor_release_identity()
  from public,anon,authenticated;
revoke all on function shorts_mvp.protect_editor_render_request_release()
  from public,anon,authenticated;
grant execute on function shorts_mvp.protect_editor_release_identity()
  to service_role;
grant execute on function shorts_mvp.protect_editor_render_request_release()
  to service_role;

alter table shorts_mvp.editor_releases enable row level security;
alter table shorts_mvp.editor_release_state enable row level security;
alter table shorts_mvp.editor_release_testers enable row level security;
alter table shorts_mvp.editor_release_checks enable row level security;

revoke all on shorts_mvp.editor_releases from anon,authenticated;
revoke all on shorts_mvp.editor_release_state from anon,authenticated;
revoke all on shorts_mvp.editor_release_testers from anon,authenticated;
revoke all on shorts_mvp.editor_release_checks from anon,authenticated;

grant all on shorts_mvp.editor_releases to service_role;
grant all on shorts_mvp.editor_release_state to service_role;
grant all on shorts_mvp.editor_release_testers to service_role;
grant all on shorts_mvp.editor_release_checks to service_role;

drop trigger if exists editor_releases_set_updated_at
  on shorts_mvp.editor_releases;
create trigger editor_releases_set_updated_at
before update on shorts_mvp.editor_releases
for each row execute function shorts_mvp.set_updated_at();

drop trigger if exists editor_release_state_set_updated_at
  on shorts_mvp.editor_release_state;
create trigger editor_release_state_set_updated_at
before update on shorts_mvp.editor_release_state
for each row execute function shorts_mvp.set_updated_at();

drop trigger if exists editor_release_testers_set_updated_at
  on shorts_mvp.editor_release_testers;
create trigger editor_release_testers_set_updated_at
before update on shorts_mvp.editor_release_testers
for each row execute function shorts_mvp.set_updated_at();

drop trigger if exists editor_release_checks_set_updated_at
  on shorts_mvp.editor_release_checks;
create trigger editor_release_checks_set_updated_at
before update on shorts_mvp.editor_release_checks
for each row execute function shorts_mvp.set_updated_at();

comment on table shorts_mvp.editor_releases is
  'Immutable editor UI/worker release artifacts and their promotion lifecycle.';
comment on table shorts_mvp.editor_release_state is
  'Singleton pointers for candidate, stable, and emergency public editor state.';
comment on table shorts_mvp.editor_release_testers is
  'Administrator-managed users allowed to enter the production editor canary.';
comment on table shorts_mvp.editor_release_checks is
  'Machine and production-canary evidence required before editor promotion.';

commit;
