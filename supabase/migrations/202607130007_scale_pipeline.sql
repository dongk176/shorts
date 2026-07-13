begin;

alter table shorts_mvp.video_jobs
  add column if not exists deadline_at timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists planned_short_count integer,
  add column if not exists ready_short_count integer not null default 0,
  add column if not exists dispatch_batch_id uuid;

update shorts_mvp.video_jobs
set deadline_at = coalesce(deadline_at, created_at + interval '90 minutes'),
    planned_short_count = coalesce(planned_short_count, expected_short_count)
where deadline_at is null or planned_short_count is null;

alter table shorts_mvp.video_jobs
  alter column deadline_at set not null,
  alter column deadline_at set default (now() + interval '90 minutes'),
  alter column planned_short_count set not null;

alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_status_check;
alter table shorts_mvp.video_jobs
  add constraint video_jobs_status_check check (status in (
    'validating', 'queued', 'retry_waiting', 'starting', 'downloading',
    'transcribing', 'selecting', 'extracting', 'rendering', 'uploading',
    'completed', 'failed', 'expired', 'deleted'
  ));
alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_planned_short_count_check;
alter table shorts_mvp.video_jobs
  add constraint video_jobs_planned_short_count_check
    check (planned_short_count between 1 and 15);
alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_ready_short_count_check;
alter table shorts_mvp.video_jobs
  add constraint video_jobs_ready_short_count_check
    check (ready_short_count between 0 and planned_short_count);

alter table shorts_mvp.generated_shorts
  alter column output_s3_key drop not null,
  add column if not exists render_shard_index integer,
  add column if not exists render_attempt_count integer not null default 0,
  add column if not exists render_error_code text,
  add column if not exists render_error_message text,
  add column if not exists render_progress integer not null default 0,
  add column if not exists render_batch_job_id text;

alter table shorts_mvp.generated_shorts
  drop constraint if exists generated_shorts_render_progress_check;
alter table shorts_mvp.generated_shorts
  add constraint generated_shorts_render_progress_check
    check (render_progress between 0 and 100);
alter table shorts_mvp.generated_shorts
  drop constraint if exists generated_shorts_ready_output_check;
alter table shorts_mvp.generated_shorts
  add constraint generated_shorts_ready_output_check check (
    status not in ('ready', 'rerendering') or output_s3_key is not null
  );

create table if not exists shorts_mvp.youtube_analyses (
  id uuid primary key default gen_random_uuid(),
  mvp_session_id uuid not null references shorts_mvp.mvp_sessions(id) on delete cascade,
  youtube_url text not null,
  youtube_video_id text not null,
  video_title text not null,
  channel_name text not null,
  thumbnail_url text not null,
  duration_seconds integer not null check (duration_seconds between 1 and 3600),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  check (expires_at <= created_at + interval '30 minutes')
);

create table if not exists shorts_mvp.job_outbox (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references shorts_mvp.video_jobs(id) on delete cascade,
  kind text not null default 'prepare' check (kind in ('prepare')),
  status text not null default 'pending' check (status in ('pending', 'dispatched', 'failed')),
  available_at timestamptz not null default now(),
  dispatch_batch_id uuid,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  unique (job_id, kind, attempt_count)
);

create table if not exists shorts_mvp.dispatch_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('prepare', 'render')),
  item_count integer not null check (item_count between 1 and 10000),
  status text not null default 'queued' check (status in ('queued', 'submitted', 'failed')),
  aws_batch_job_id text,
  error_message text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);

create table if not exists shorts_mvp.short_outbox (
  id uuid primary key default gen_random_uuid(),
  short_id uuid not null references shorts_mvp.generated_shorts(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','dispatched','failed')),
  available_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  unique (short_id)
);

create table if not exists shorts_mvp.dispatch_batch_items (
  dispatch_batch_id uuid not null references shorts_mvp.dispatch_batches(id) on delete cascade,
  array_index integer not null check (array_index >= 0),
  job_id uuid not null references shorts_mvp.video_jobs(id) on delete cascade,
  primary key (dispatch_batch_id, array_index),
  unique (dispatch_batch_id, job_id)
);

create table if not exists shorts_mvp.ingestion_attempts (
  id bigint generated always as identity primary key,
  job_id uuid references shorts_mvp.video_jobs(id) on delete cascade,
  result text not null check (result in ('success', 'bot_check', 'other_error')),
  created_at timestamptz not null default now()
);

create index if not exists youtube_analyses_session_expires_idx
  on shorts_mvp.youtube_analyses (mvp_session_id, expires_at);
create index if not exists job_outbox_pending_idx
  on shorts_mvp.job_outbox (available_at, created_at) where status='pending';
create index if not exists dispatch_batch_items_job_idx
  on shorts_mvp.dispatch_batch_items (job_id);
create index if not exists short_outbox_pending_idx
  on shorts_mvp.short_outbox (available_at, created_at) where status='pending';
create index if not exists ingestion_attempts_created_idx
  on shorts_mvp.ingestion_attempts (created_at desc);
create index if not exists generated_shorts_render_shard_idx
  on shorts_mvp.generated_shorts (job_id, render_shard_index, status);
create index if not exists video_jobs_deadline_idx
  on shorts_mvp.video_jobs (deadline_at)
  where status not in ('completed', 'failed', 'expired', 'deleted');

create or replace function shorts_mvp.claim_job_outbox(p_limit integer default 10000)
returns table (dispatch_batch_id uuid, item_count integer)
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  claimed_batch_id uuid := gen_random_uuid();
  claimed_count integer;
begin
  insert into shorts_mvp.dispatch_batches (id, kind, item_count)
  values (claimed_batch_id, 'prepare', 1);

  with locked as materialized (
    select o.id, o.job_id, o.available_at, o.created_at
    from shorts_mvp.job_outbox o
    join shorts_mvp.video_jobs j on j.id=o.job_id
    where o.status='pending'
      and o.available_at <= now()
      and j.status in ('queued', 'retry_waiting')
      and j.deadline_at > now() + interval '5 minutes'
    order by o.available_at, o.created_at
    for update of o skip locked
    limit greatest(1, least(p_limit, 10000))
  ), candidates as (
    select id, job_id,
      row_number() over (order by available_at, created_at) - 1 as array_index
    from locked
  )
  insert into shorts_mvp.dispatch_batch_items (dispatch_batch_id, array_index, job_id)
  select claimed_batch_id, array_index, job_id from candidates;
  get diagnostics claimed_count = row_count;

  if claimed_count = 0 then
    delete from shorts_mvp.dispatch_batches where id=claimed_batch_id;
    return;
  end if;

  update shorts_mvp.dispatch_batches set item_count=claimed_count
  where id=claimed_batch_id;

  update shorts_mvp.job_outbox o
  set status='dispatched', dispatch_batch_id=claimed_batch_id, dispatched_at=now()
  where o.job_id in (
    select i.job_id from shorts_mvp.dispatch_batch_items i
    where i.dispatch_batch_id=claimed_batch_id
  ) and o.status='pending';

  update shorts_mvp.video_jobs j
  set dispatch_batch_id=claimed_batch_id
  where j.id in (
    select i.job_id from shorts_mvp.dispatch_batch_items i
    where i.dispatch_batch_id=claimed_batch_id
  );

  return query select claimed_batch_id, claimed_count;
end;
$$;

create or replace function shorts_mvp.claim_short_outbox(p_limit integer default 100)
returns table (outbox_id uuid, short_id uuid)
language sql
security definer
set search_path = shorts_mvp, pg_temp
as $$
  with candidates as (
    select o.id from shorts_mvp.short_outbox o
    join shorts_mvp.generated_shorts s on s.id=o.short_id
    where o.status='pending' and o.available_at <= now() and s.status='rerendering'
    order by o.available_at, o.created_at
    for update of o skip locked
    limit greatest(1,least(p_limit,100))
  )
  update shorts_mvp.short_outbox o
  set status='dispatched', dispatched_at=now()
  from candidates c where o.id=c.id
  returning o.id, o.short_id;
$$;

create or replace function shorts_mvp.maybe_complete_video_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  expected_count integer;
  ready_count integer;
  reservation_row shorts_mvp.usage_reservations%rowtype;
begin
  select planned_short_count into expected_count
  from shorts_mvp.video_jobs where id=p_job_id for update;
  if expected_count is null then return false; end if;

  select count(*) into ready_count
  from shorts_mvp.generated_shorts
  where job_id=p_job_id and status='ready' and deleted_at is null;

  update shorts_mvp.video_jobs
  set ready_short_count=least(ready_count, planned_short_count),
      progress=case when ready_count >= expected_count then 100
                    else greatest(progress, 60 + floor(35.0 * ready_count / expected_count)::int) end,
      heartbeat_at=now()
  where id=p_job_id;

  if ready_count < expected_count then return false; end if;

  update shorts_mvp.usage_reservations
  set status='consumed', consumed_at=now()
  where job_id=p_job_id and status='reserved'
  returning * into reservation_row;

  if reservation_row.id is not null then
    insert into shorts_mvp.usage_events
      (mvp_session_id, user_id, job_id, event_type, source_duration_seconds)
    values (
      reservation_row.mvp_session_id, reservation_row.user_id, p_job_id,
      'source_consumed', reservation_row.source_duration_seconds
    ) on conflict (job_id, event_type) do nothing;
  end if;

  update shorts_mvp.video_jobs
  set status='completed', stage='completed', progress=100,
      completed_at=coalesce(completed_at, now()), source_deleted_at=now(),
      heartbeat_at=now(),
      expires_at=(select max(expires_at) from shorts_mvp.generated_shorts where job_id=p_job_id)
  where id=p_job_id and status <> 'completed';

  if found then
    insert into shorts_mvp.job_events (job_id, stage, progress, message)
    values (p_job_id, 'completed', 100, '완료되었습니다.');
  end if;
  return true;
end;
$$;

create or replace function shorts_mvp.apply_job_state_event(
  p_job_id uuid,
  p_stage text,
  p_progress integer,
  p_message text,
  p_event_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
begin
  update shorts_mvp.video_jobs
  set status=coalesce(p_stage,status), stage=coalesce(p_stage,stage),
      progress=case when p_stage is null then progress
                    else greatest(progress,least(100,greatest(0,p_progress))) end,
      heartbeat_at=p_event_at
  where id=p_job_id
    and status not in ('completed','failed','expired','deleted','retry_waiting')
    and (heartbeat_at is null or heartbeat_at <= p_event_at);
  if not found then return false; end if;
  if p_stage is not null then
    insert into shorts_mvp.job_events (job_id,stage,progress,message)
    values (p_job_id,p_stage,least(100,greatest(0,p_progress)),left(p_message,500));
  end if;
  return true;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'youtube_analyses', 'job_outbox', 'dispatch_batches',
    'dispatch_batch_items', 'short_outbox', 'ingestion_attempts'
  ] loop
    execute format('alter table shorts_mvp.%I enable row level security', table_name);
    execute format('revoke all on table shorts_mvp.%I from anon, authenticated', table_name);
    execute format('grant all on table shorts_mvp.%I to service_role', table_name);
  end loop;
end $$;

grant execute on function shorts_mvp.claim_job_outbox(integer) to service_role;
grant execute on function shorts_mvp.claim_short_outbox(integer) to service_role;
grant execute on function shorts_mvp.maybe_complete_video_job(uuid) to service_role;
grant execute on function shorts_mvp.apply_job_state_event(uuid,text,integer,text,timestamptz)
  to service_role;
grant usage, select on all sequences in schema shorts_mvp to service_role;
grant all on table shorts_mvp.ingestion_circuit to service_role;

commit;
