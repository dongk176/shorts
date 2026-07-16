begin;

alter table shorts_mvp.video_jobs
  add column if not exists queue_expires_at timestamptz,
  add column if not exists ingestion_route_id text,
  add column if not exists ingestion_route_leased_at timestamptz;

update shorts_mvp.video_jobs
set queue_expires_at=coalesce(queue_expires_at, created_at + interval '6 hours')
where queue_expires_at is null;

alter table shorts_mvp.video_jobs
  alter column queue_expires_at set default (now() + interval '6 hours'),
  alter column queue_expires_at set not null;

alter table shorts_mvp.ingestion_attempts
  add column if not exists route_id text,
  add column if not exists egress_class text,
  add column if not exists job_attempt integer;

create table if not exists shorts_mvp.ingestion_route_slots (
  route_id text primary key check (route_id ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  egress_class text not null check (egress_class in ('webshare_isp','warp','contracted_proxy')),
  enabled boolean not null default true,
  leased_job_id uuid unique references shorts_mvp.video_jobs(id) on delete set null,
  lease_expires_at timestamptz,
  cooldown_until timestamptz,
  last_job_id uuid references shorts_mvp.video_jobs(id) on delete set null,
  last_result text check (
    last_result is null or last_result in (
      'success','bot_check','network_error','terminal','batch_failed','dispatch_failed','deadline'
    )
  ),
  last_leased_at timestamptz,
  last_released_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (leased_job_id is null and lease_expires_at is null)
    or (leased_job_id is not null and lease_expires_at is not null)
  )
);

insert into shorts_mvp.ingestion_route_slots (route_id,egress_class)
select 'webshare-' || lpad(value::text, 2, '0'), 'webshare_isp'
from generate_series(1,10) value
on conflict (route_id) do nothing;

alter table shorts_mvp.ingestion_route_slots enable row level security;
revoke all on table shorts_mvp.ingestion_route_slots from anon, authenticated;
grant all on table shorts_mvp.ingestion_route_slots to service_role;

create index if not exists ingestion_route_slots_available_idx
  on shorts_mvp.ingestion_route_slots (enabled,cooldown_until,last_leased_at)
  where leased_job_id is null;
create index if not exists ingestion_attempts_route_created_idx
  on shorts_mvp.ingestion_attempts (route_id,created_at desc);
create index if not exists video_jobs_queue_expiry_idx
  on shorts_mvp.video_jobs (queue_expires_at)
  where status in ('queued','retry_waiting');

create or replace function shorts_mvp.release_ingestion_route(
  p_job_id uuid,
  p_route_id text,
  p_result text,
  p_cooldown_seconds integer default 0
)
returns boolean
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  released_count integer;
  bounded_cooldown integer := least(greatest(coalesce(p_cooldown_seconds,0),0),3600);
begin
  if p_result not in (
    'success','bot_check','network_error','terminal','batch_failed','dispatch_failed','deadline'
  ) then
    raise exception 'unsupported ingestion route result';
  end if;

  update shorts_mvp.ingestion_route_slots
  set leased_job_id=null,
      lease_expires_at=null,
      cooldown_until=case
        when bounded_cooldown > 0 then clock_timestamp() + make_interval(secs => bounded_cooldown)
        else null
      end,
      last_job_id=p_job_id,
      last_result=p_result,
      last_released_at=clock_timestamp(),
      updated_at=clock_timestamp()
  where route_id=p_route_id and leased_job_id=p_job_id;
  get diagnostics released_count = row_count;

  update shorts_mvp.video_jobs
  set ingestion_route_id=null, ingestion_route_leased_at=null
  where id=p_job_id and ingestion_route_id=p_route_id;

  return released_count = 1;
end;
$$;

create or replace function shorts_mvp.release_dispatch_batch_routes(
  p_dispatch_batch_id uuid
)
returns integer
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  released_count integer;
begin
  with released as (
    update shorts_mvp.ingestion_route_slots s
    set leased_job_id=null,
        lease_expires_at=null,
        cooldown_until=null,
        last_job_id=s.leased_job_id,
        last_result='dispatch_failed',
        last_released_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where s.leased_job_id in (
      select i.job_id from shorts_mvp.dispatch_batch_items i
      where i.dispatch_batch_id=p_dispatch_batch_id
    )
    returning s.last_job_id
  )
  update shorts_mvp.video_jobs j
  set ingestion_route_id=null, ingestion_route_leased_at=null
  where j.id in (select last_job_id from released);
  get diagnostics released_count = row_count;
  return released_count;
end;
$$;

create or replace function shorts_mvp.enqueue_prepare_retry(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  inserted_count integer;
begin
  insert into shorts_mvp.job_outbox (job_id,kind,attempt_count,available_at)
  select j.id, 'prepare', j.attempt_count,
         greatest(coalesce(j.next_attempt_at,clock_timestamp()),clock_timestamp())
  from shorts_mvp.video_jobs j
  where j.id=p_job_id
    and j.status='retry_waiting'
    and j.attempt_count < 10
    and j.queue_expires_at > clock_timestamp()
  on conflict (job_id,kind,attempt_count) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

create or replace function shorts_mvp.claim_job_outbox(p_limit integer default 10000)
returns table (dispatch_batch_id uuid, item_count integer)
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  claimed_batch_id uuid := gen_random_uuid();
  claimed_count integer;
  free_route_count integer;
  claim_limit integer;
begin
  with released as (
    update shorts_mvp.ingestion_route_slots s
    set leased_job_id=null,
        lease_expires_at=null,
        last_job_id=s.leased_job_id,
        last_result='batch_failed',
        last_released_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where s.leased_job_id is not null and (
      s.lease_expires_at <= clock_timestamp()
      or not exists (
        select 1 from shorts_mvp.video_jobs j
        where j.id=s.leased_job_id
          and j.ingestion_route_id=s.route_id
          and j.status not in ('completed','failed','expired','deleted')
      )
    )
    returning s.last_job_id,s.route_id
  )
  update shorts_mvp.video_jobs j
  set ingestion_route_id=null,ingestion_route_leased_at=null
  where exists (
    select 1 from released r
    where r.last_job_id=j.id and r.route_id=j.ingestion_route_id
  );

  select count(*)::integer into free_route_count
  from shorts_mvp.ingestion_route_slots s
  where s.enabled
    and s.leased_job_id is null
    and coalesce(s.cooldown_until,'-infinity'::timestamptz) <= clock_timestamp();

  claim_limit := least(greatest(coalesce(p_limit,1),1),10000,free_route_count);
  if claim_limit < 1 then
    return;
  end if;

  insert into shorts_mvp.dispatch_batches (id,kind,item_count)
  values (claimed_batch_id,'prepare',1);

  with locked_jobs as materialized (
    select o.id as outbox_id, o.job_id, o.available_at, o.created_at
    from shorts_mvp.job_outbox o
    join shorts_mvp.video_jobs j on j.id=o.job_id
    where o.status='pending'
      and o.available_at <= clock_timestamp()
      and j.status in ('queued','retry_waiting')
      and j.queue_expires_at > clock_timestamp()
      and j.attempt_count < 10
    order by o.available_at,o.created_at
    for update of o skip locked
    limit claim_limit
  ), numbered_jobs as materialized (
    select l.*,
      row_number() over (order by l.available_at,l.created_at,l.outbox_id) as row_number
    from locked_jobs l
  ), locked_routes as materialized (
    select s.route_id, s.last_leased_at
    from shorts_mvp.ingestion_route_slots s
    where s.enabled
      and s.leased_job_id is null
      and coalesce(s.cooldown_until,'-infinity'::timestamptz) <= clock_timestamp()
    order by s.last_leased_at nulls first,s.route_id
    for update of s skip locked
    limit claim_limit
  ), numbered_routes as materialized (
    select l.*,
      row_number() over (order by l.last_leased_at nulls first,l.route_id) as row_number
    from locked_routes l
  ), pairs as materialized (
    select j.outbox_id,j.job_id,j.row_number,r.route_id
    from numbered_jobs j
    join numbered_routes r using (row_number)
  ), leased_routes as (
    update shorts_mvp.ingestion_route_slots s
    set leased_job_id=p.job_id,
        lease_expires_at=clock_timestamp() + interval '20 minutes',
        cooldown_until=null,
        last_leased_at=clock_timestamp(),
        updated_at=clock_timestamp()
    from pairs p
    where s.route_id=p.route_id and s.leased_job_id is null
    returning s.route_id,s.leased_job_id
  ), assigned_jobs as (
    update shorts_mvp.video_jobs j
    set ingestion_route_id=l.route_id,
        ingestion_route_leased_at=clock_timestamp(),
        deadline_at=clock_timestamp() + make_interval(
          mins => 30 + ceil(j.source_duration_seconds / 60.0)::integer
        )
    from leased_routes l
    where j.id=l.leased_job_id
    returning j.id,j.ingestion_route_id
  ), inserted_items as (
    insert into shorts_mvp.dispatch_batch_items (dispatch_batch_id,array_index,job_id)
    select claimed_batch_id,(p.row_number - 1)::integer,p.job_id
    from pairs p
    join assigned_jobs j on j.id=p.job_id and j.ingestion_route_id=p.route_id
    order by p.row_number
    returning job_id
  )
  select count(*)::integer into claimed_count from inserted_items;

  if claimed_count = 0 then
    delete from shorts_mvp.dispatch_batches where id=claimed_batch_id;
    return;
  end if;

  update shorts_mvp.dispatch_batches
  set item_count=claimed_count
  where id=claimed_batch_id;

  update shorts_mvp.job_outbox o
  set status='dispatched',dispatch_batch_id=claimed_batch_id,dispatched_at=clock_timestamp()
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

  return query select claimed_batch_id,claimed_count;
end;
$$;

create or replace function shorts_mvp.handle_prepare_batch_failure(
  p_job_id uuid,
  p_batch_job_id text,
  p_reason text
)
returns table (action text, counted_attempt integer)
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  current_job shorts_mvp.video_jobs%rowtype;
  next_attempt integer;
begin
  select * into current_job
  from shorts_mvp.video_jobs
  where id=p_job_id
  for update;

  if not found
    or current_job.status in ('completed','failed','expired','deleted')
    or current_job.aws_batch_job_id is distinct from p_batch_job_id then
    return query select 'ignored'::text,coalesce(current_job.attempt_count,0);
    return;
  end if;

  if current_job.ingestion_route_id is not null then
    perform shorts_mvp.release_ingestion_route(
      p_job_id,current_job.ingestion_route_id,'batch_failed',60
    );
  end if;

  next_attempt := current_job.attempt_count
    + case when current_job.status='queued' then 1 else 0 end;

  if next_attempt >= 10
    or current_job.deadline_at <= clock_timestamp() + interval '5 minutes' then
    update shorts_mvp.video_jobs
    set status='failed',stage='failed',progress=100,
        attempt_count=next_attempt,error_code='batch_failed',
        error_message=(
          '영상을 가져오지 못했습니다. 영상이 공개 상태인지, 로그인·연령·지역 제한이 '
          || '없는지, 삭제되거나 비공개 처리되지 않았는지 확인한 뒤 다시 시도해 주세요.'
        ),
        source_deleted_at=now(),heartbeat_at=now()
    where id=p_job_id;
    update shorts_mvp.usage_reservations
    set status='released',released_at=now()
    where job_id=p_job_id and status='reserved';
    insert into shorts_mvp.job_events (job_id,stage,progress,message,metadata)
    values (
      p_job_id,'failed',100,
      '영상을 가져오지 못했습니다. 영상의 공개 및 제한 상태를 확인해 주세요.',
      jsonb_build_object('internal_error',left(p_reason,300))
    );
    return query select 'failed'::text,next_attempt;
    return;
  end if;

  update shorts_mvp.video_jobs
  set status='retry_waiting',stage='downloading',progress=10,
      attempt_count=next_attempt,next_attempt_at=now() + interval '60 seconds',
      error_code='batch_failed',error_message=null,heartbeat_at=now()
  where id=p_job_id;
  if current_job.status <> 'retry_waiting' then
    insert into shorts_mvp.job_events (job_id,stage,progress,message,metadata)
    values (
      p_job_id,'retry_waiting',10,'원본 영상을 다시 준비하고 있습니다.',
      jsonb_build_object('internal_error',left(p_reason,300))
    );
  end if;
  return query select 'retry'::text,next_attempt;
end;
$$;

create or replace function shorts_mvp.fail_video_job_at_deadline(p_job_id uuid)
returns table (failed boolean)
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  current_job shorts_mvp.video_jobs%rowtype;
begin
  select * into current_job
  from shorts_mvp.video_jobs
  where id=p_job_id
  for update;

  if not found
    or current_job.status in ('completed','failed','expired','deleted')
    or (
      current_job.status in ('queued','retry_waiting')
      and current_job.queue_expires_at > clock_timestamp()
    )
    or (
      current_job.status not in ('queued','retry_waiting')
      and current_job.deadline_at > clock_timestamp()
    ) then
    return query select false;
    return;
  end if;

  if current_job.ingestion_route_id is not null then
    perform shorts_mvp.release_ingestion_route(
      p_job_id,current_job.ingestion_route_id,'deadline',0
    );
  end if;

  update shorts_mvp.video_jobs
  set status='failed',stage='failed',progress=100,
      error_code='job_deadline',
      error_message='쇼츠를 만드는 중 작업 제한 시간이 종료되었습니다. 다시 시도해 주세요.',
      source_deleted_at=now(),heartbeat_at=now()
  where id=p_job_id;

  update shorts_mvp.usage_reservations
  set status='released',released_at=now()
  where job_id=p_job_id and status='reserved';

  update shorts_mvp.generated_shorts
  set status='failed',render_progress=0,
      render_error_code='job_deadline',
      render_error_message='쇼츠를 만드는 중 작업 제한 시간이 종료되었습니다. 다시 시도해 주세요.'
  where job_id=p_job_id
    and status in ('rendering','rerendering','ready')
    and deleted_at is null;

  insert into shorts_mvp.job_events (job_id,stage,progress,message)
  values (p_job_id,'failed',100,'작업 제한 시간이 종료되었습니다.');
  return query select true;
end;
$$;

grant execute on function shorts_mvp.release_ingestion_route(uuid,text,text,integer)
  to service_role;
grant execute on function shorts_mvp.release_dispatch_batch_routes(uuid)
  to service_role;
grant execute on function shorts_mvp.enqueue_prepare_retry(uuid)
  to service_role;
grant execute on function shorts_mvp.claim_job_outbox(integer)
  to service_role;
grant execute on function shorts_mvp.handle_prepare_batch_failure(uuid,text,text)
  to service_role;
grant execute on function shorts_mvp.fail_video_job_at_deadline(uuid)
  to service_role;

commit;
