begin;

create schema if not exists shorts_mvp;
revoke all on schema shorts_mvp from public, anon, authenticated;
grant usage on schema shorts_mvp to service_role;

create or replace function shorts_mvp.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, shorts_mvp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists shorts_mvp.plans (
  code text primary key check (code in ('plus', 'standard', 'pro')),
  display_name text not null,
  monthly_source_seconds integer not null check (monthly_source_seconds > 0),
  retention_days integer not null default 30 check (retention_days between 1 and 30),
  sort_order integer not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into shorts_mvp.plans
  (code, display_name, monthly_source_seconds, retention_days, sort_order)
values
  ('plus', 'Plus', 6000, 30, 10),
  ('standard', 'Standard', 18000, 30, 20),
  ('pro', 'Pro', 36000, 30, 30)
on conflict (code) do update set
  display_name = excluded.display_name,
  monthly_source_seconds = excluded.monthly_source_seconds,
  retention_days = excluded.retention_days,
  sort_order = excluded.sort_order,
  updated_at = now();

create table if not exists shorts_mvp.app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shorts_mvp.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  plan_code text not null references shorts_mvp.plans(code),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shorts_mvp.mvp_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (length(token_hash) = 64),
  selected_plan_code text not null default 'plus' references shorts_mvp.plans(code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists shorts_mvp.video_jobs (
  id uuid primary key default gen_random_uuid(),
  mvp_session_id uuid not null references shorts_mvp.mvp_sessions(id) on delete cascade,
  user_id uuid references shorts_mvp.app_users(id) on delete set null,
  request_id uuid not null unique,
  youtube_url text not null,
  youtube_video_id text not null,
  video_title text not null,
  channel_name text not null,
  thumbnail_url text not null,
  source_duration_seconds integer not null check (source_duration_seconds between 1 and 3600),
  range_start_seconds numeric(10,3) not null default 0 check (range_start_seconds >= 0),
  range_end_seconds numeric(10,3) not null check (range_end_seconds > range_start_seconds),
  template_id text not null check (template_id in ('dark-red', 'white-yellow', 'dark-minimal', 'paper')),
  clip_length_option text not null check (clip_length_option in ('sec_30', 'sec_31_60', 'sec_61_180')),
  expected_short_count integer not null check (expected_short_count between 1 and 5),
  rights_confirmed boolean not null check (rights_confirmed),
  status text not null default 'queued' check (status in (
    'validating', 'queued', 'starting', 'downloading', 'transcribing', 'selecting',
    'extracting', 'rendering', 'uploading', 'completed', 'failed', 'expired', 'deleted'
  )),
  stage text not null default 'queued',
  progress integer not null default 0 check (progress between 0 and 100),
  error_code text,
  error_message text,
  aws_batch_job_id text,
  batch_job_definition text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  heartbeat_at timestamptz,
  source_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz
);

-- Keep this migration idempotent for projects created before range selection shipped.
alter table shorts_mvp.video_jobs
  add column if not exists range_start_seconds numeric(10,3) not null default 0;
alter table shorts_mvp.video_jobs
  add column if not exists range_end_seconds numeric(10,3);
update shorts_mvp.video_jobs
set range_end_seconds = source_duration_seconds
where range_end_seconds is null;
alter table shorts_mvp.video_jobs alter column range_end_seconds set not null;
alter table shorts_mvp.video_jobs drop constraint if exists video_jobs_range_bounds_check;
alter table shorts_mvp.video_jobs add constraint video_jobs_range_bounds_check check (
  range_start_seconds >= 0
  and range_end_seconds > range_start_seconds
  and range_end_seconds <= source_duration_seconds
);

create table if not exists shorts_mvp.generated_shorts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references shorts_mvp.video_jobs(id) on delete cascade,
  mvp_session_id uuid not null references shorts_mvp.mvp_sessions(id) on delete cascade,
  user_id uuid references shorts_mvp.app_users(id) on delete set null,
  clip_index integer not null check (clip_index between 1 and 5),
  start_seconds numeric(10,3) not null check (start_seconds >= 0),
  end_seconds numeric(10,3) not null,
  duration_seconds numeric(10,3) not null check (duration_seconds > 0 and duration_seconds <= 180),
  hook_title text not null check (char_length(hook_title) between 1 and 80),
  channel_display_name text not null check (char_length(channel_display_name) between 1 and 50),
  subtitle_segments jsonb not null default '[]'::jsonb,
  subtitles_enabled boolean not null default false,
  template_id text not null check (template_id in ('dark-red', 'white-yellow', 'dark-minimal', 'paper')),
  clean_clip_s3_key text not null,
  output_s3_key text not null,
  thumbnail_s3_key text,
  render_version integer not null default 1 check (render_version >= 1),
  rendered_config_hash text,
  pending_render_hash text,
  rerender_batch_job_id text,
  status text not null default 'ready' check (status in ('rendering', 'ready', 'rerendering', 'failed', 'expired', 'deleted')),
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at <= created_at + interval '30 days'),
  deleted_at timestamptz,
  unique (job_id, clip_index)
);

alter table shorts_mvp.generated_shorts alter column subtitles_enabled set default false;

create table if not exists shorts_mvp.usage_reservations (
  id uuid primary key default gen_random_uuid(),
  mvp_session_id uuid not null references shorts_mvp.mvp_sessions(id) on delete cascade,
  user_id uuid references shorts_mvp.app_users(id) on delete set null,
  job_id uuid not null references shorts_mvp.video_jobs(id) on delete cascade,
  source_duration_seconds integer not null check (source_duration_seconds between 1 and 3600),
  status text not null default 'reserved' check (status in ('reserved', 'consumed', 'released')),
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  released_at timestamptz,
  unique (job_id)
);

create table if not exists shorts_mvp.usage_events (
  id uuid primary key default gen_random_uuid(),
  mvp_session_id uuid not null references shorts_mvp.mvp_sessions(id) on delete cascade,
  user_id uuid references shorts_mvp.app_users(id) on delete set null,
  job_id uuid not null references shorts_mvp.video_jobs(id) on delete cascade,
  event_type text not null check (event_type in ('source_consumed', 'reservation_released')),
  source_duration_seconds integer not null check (source_duration_seconds between 1 and 3600),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (job_id, event_type)
);

create table if not exists shorts_mvp.job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references shorts_mvp.video_jobs(id) on delete cascade,
  stage text not null,
  progress integer not null check (progress between 0 and 100),
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists video_jobs_session_created_idx on shorts_mvp.video_jobs (mvp_session_id, created_at desc);
create index if not exists video_jobs_status_created_idx on shorts_mvp.video_jobs (status, created_at);
create index if not exists video_jobs_expires_idx on shorts_mvp.video_jobs (expires_at) where expires_at is not null;
create index if not exists generated_shorts_job_clip_idx on shorts_mvp.generated_shorts (job_id, clip_index);
create index if not exists generated_shorts_expires_idx on shorts_mvp.generated_shorts (expires_at) where deleted_at is null;
create index if not exists usage_reservations_session_created_idx on shorts_mvp.usage_reservations (mvp_session_id, created_at);
create index if not exists usage_events_session_occurred_idx on shorts_mvp.usage_events (mvp_session_id, occurred_at);
create index if not exists job_events_job_created_idx on shorts_mvp.job_events (job_id, created_at);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'plans', 'app_users', 'user_subscriptions', 'mvp_sessions', 'video_jobs',
    'generated_shorts', 'usage_reservations', 'usage_events', 'job_events'
  ] loop
    execute format('alter table shorts_mvp.%I enable row level security', table_name);
    execute format('revoke all on table shorts_mvp.%I from anon, authenticated', table_name);
    execute format('grant all on table shorts_mvp.%I to service_role', table_name);
  end loop;
end $$;

grant usage, select on all sequences in schema shorts_mvp to service_role;

drop trigger if exists plans_set_updated_at on shorts_mvp.plans;
create trigger plans_set_updated_at before update on shorts_mvp.plans
for each row execute function shorts_mvp.set_updated_at();
drop trigger if exists app_users_set_updated_at on shorts_mvp.app_users;
create trigger app_users_set_updated_at before update on shorts_mvp.app_users
for each row execute function shorts_mvp.set_updated_at();
drop trigger if exists subscriptions_set_updated_at on shorts_mvp.user_subscriptions;
create trigger subscriptions_set_updated_at before update on shorts_mvp.user_subscriptions
for each row execute function shorts_mvp.set_updated_at();
drop trigger if exists sessions_set_updated_at on shorts_mvp.mvp_sessions;
create trigger sessions_set_updated_at before update on shorts_mvp.mvp_sessions
for each row execute function shorts_mvp.set_updated_at();
drop trigger if exists shorts_set_updated_at on shorts_mvp.generated_shorts;
create trigger shorts_set_updated_at before update on shorts_mvp.generated_shorts
for each row execute function shorts_mvp.set_updated_at();

commit;
