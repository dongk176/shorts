begin;

set local lock_timeout = '3s';

alter table shorts_mvp.ingestion_route_slots
  add column if not exists quality_reset_at timestamptz
    not null default '-infinity'::timestamptz;

comment on column shorts_mvp.ingestion_route_slots.quality_reset_at is
  'Only ingestion attempts at or after this boundary contribute to route quality ranking';

insert into shorts_mvp.runtime_feature_flags (
  flag_key,enabled,description
) values (
  'ingestion_success_priority',
  false,
  '최근 24시간의 경로별 성공률 등급 안에서 오래 사용하지 않은 수집 경로를 우선 배정'
)
on conflict (flag_key) do nothing;

create or replace function shorts_mvp.ingestion_route_quality(
  p_route_id text
)
returns table (
  quality_tier integer,
  sample_count integer,
  success_count integer,
  success_rate numeric
)
language sql
stable
security definer
set search_path = shorts_mvp, pg_temp
as $$
  with route_boundary as (
    select greatest(
      now() - interval '24 hours',
      s.quality_reset_at
    ) as quality_since
    from shorts_mvp.ingestion_route_slots s
    where s.route_id=p_route_id
  ), recent_attempts as (
    select a.result
    from shorts_mvp.ingestion_attempts a
    cross join route_boundary boundary
    where a.route_id=p_route_id
      and a.created_at >= boundary.quality_since
    order by a.created_at desc,a.id desc
    limit 20
  ), quality as (
    select
      count(*)::integer as sampled,
      count(*) filter (where result='success')::integer as successful
    from recent_attempts
  )
  select
    case
      when sampled >= 5 and successful * 4 >= sampled then 0
      when sampled < 5 then 1
      when successful > 0 then 2
      else 3
    end as quality_tier,
    sampled as sample_count,
    successful as success_count,
    case
      when sampled = 0 then 0::numeric
      else successful::numeric / sampled::numeric
    end as success_rate
  from quality;
$$;

revoke all on function shorts_mvp.ingestion_route_quality(text)
  from public, anon, authenticated;
grant execute on function shorts_mvp.ingestion_route_quality(text)
  to service_role;

create or replace function shorts_mvp.reset_ingestion_route_quality(
  p_route_id text
)
returns boolean
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  reset_count integer;
begin
  update shorts_mvp.ingestion_route_slots s
  set quality_reset_at=clock_timestamp(),
      cooldown_until=null,
      last_result=null,
      updated_at=clock_timestamp()
  where s.route_id=p_route_id
    and s.leased_job_id is null;
  get diagnostics reset_count = row_count;
  return reset_count = 1;
end;
$$;

revoke all on function shorts_mvp.reset_ingestion_route_quality(text)
  from public, anon, authenticated;
grant execute on function shorts_mvp.reset_ingestion_route_quality(text)
  to service_role;

create or replace function shorts_mvp.rotate_ingestion_route(
  p_job_id uuid,
  p_current_route_id text,
  p_result text,
  p_cooldown_seconds integer default 0,
  p_excluded_route_ids text[] default array[]::text[]
)
returns table (route_id text)
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  current_job shorts_mvp.video_jobs%rowtype;
  next_route_id text;
  success_priority_enabled boolean := false;
begin
  select * into current_job
  from shorts_mvp.video_jobs
  where id=p_job_id
  for update;

  if not found
    or current_job.status in ('completed','failed','expired','deleted')
    or current_job.deadline_at <= clock_timestamp() + interval '5 minutes' then
    return;
  end if;

  if p_current_route_id is not null then
    if current_job.ingestion_route_id is distinct from p_current_route_id then
      return;
    end if;
    perform shorts_mvp.release_ingestion_route(
      p_job_id,
      p_current_route_id,
      p_result,
      p_cooldown_seconds
    );
  elsif current_job.ingestion_route_id is not null then
    return;
  end if;

  select coalesce((
    select flag.enabled
    from shorts_mvp.runtime_feature_flags flag
    where flag.flag_key='ingestion_success_priority'
  ),false) into success_priority_enabled;

  select s.route_id into next_route_id
  from shorts_mvp.ingestion_route_slots s
  cross join lateral shorts_mvp.ingestion_route_quality(s.route_id) quality
  where s.enabled
    and s.leased_job_id is null
    and coalesce(s.cooldown_until,'-infinity'::timestamptz) <= clock_timestamp()
    and not (s.route_id = any(coalesce(p_excluded_route_ids,array[]::text[])))
  order by
    case when success_priority_enabled then quality.quality_tier else 0 end,
    s.last_leased_at nulls first,
    s.route_id
  for update of s skip locked
  limit 1;

  if next_route_id is null then
    return;
  end if;

  update shorts_mvp.ingestion_route_slots s
  set leased_job_id=p_job_id,
      lease_expires_at=clock_timestamp() + interval '20 minutes',
      cooldown_until=null,
      last_leased_at=clock_timestamp(),
      updated_at=clock_timestamp()
  where s.route_id=next_route_id
    and s.leased_job_id is null;

  if not found then
    return;
  end if;

  update shorts_mvp.video_jobs j
  set ingestion_route_id=next_route_id,
      ingestion_route_leased_at=clock_timestamp(),
      heartbeat_at=clock_timestamp()
  where j.id=p_job_id;

  return query select next_route_id;
end;
$$;

revoke all on function shorts_mvp.rotate_ingestion_route(uuid,text,text,integer,text[])
  from public, anon, authenticated;
grant execute on function shorts_mvp.rotate_ingestion_route(uuid,text,text,integer,text[])
  to service_role;

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
  success_priority_enabled boolean := false;
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

  select coalesce((
    select flag.enabled
    from shorts_mvp.runtime_feature_flags flag
    where flag.flag_key='ingestion_success_priority'
  ),false) into success_priority_enabled;

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
    select s.route_id,s.last_leased_at,quality.quality_tier
    from shorts_mvp.ingestion_route_slots s
    cross join lateral shorts_mvp.ingestion_route_quality(s.route_id) quality
    where s.enabled
      and s.leased_job_id is null
      and coalesce(s.cooldown_until,'-infinity'::timestamptz) <= clock_timestamp()
    order by
      case when success_priority_enabled then quality.quality_tier else 0 end,
      s.last_leased_at nulls first,
      s.route_id
    for update of s skip locked
    limit claim_limit
  ), numbered_routes as materialized (
    select l.*,
      row_number() over (
        order by
          case when success_priority_enabled then l.quality_tier else 0 end,
          l.last_leased_at nulls first,
          l.route_id
      ) as row_number
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

revoke all on function shorts_mvp.claim_job_outbox(integer)
  from public, anon, authenticated;
grant execute on function shorts_mvp.claim_job_outbox(integer)
  to service_role;

create or replace function shorts_mvp.claim_project_job_outbox(p_limit integer default 100)
returns table (
  outbox_id uuid,
  job_id uuid,
  route_id text,
  mvp_session_id uuid,
  user_id uuid,
  priority_class text
)
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  free_route_count integer;
  claim_limit integer;
  success_priority_enabled boolean := false;
begin
  with released as (
    update shorts_mvp.ingestion_route_slots s
    set leased_job_id=null,lease_expires_at=null,last_job_id=s.leased_job_id,
        last_result='batch_failed',last_released_at=clock_timestamp(),updated_at=clock_timestamp()
    where s.leased_job_id is not null and (
      s.lease_expires_at <= clock_timestamp()
      or not exists (
        select 1 from shorts_mvp.video_jobs j
        where j.id=s.leased_job_id and j.ingestion_route_id=s.route_id
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

  select coalesce((
    select flag.enabled
    from shorts_mvp.runtime_feature_flags flag
    where flag.flag_key='ingestion_success_priority'
  ),false) into success_priority_enabled;

  select count(*)::integer into free_route_count
  from shorts_mvp.ingestion_route_slots s
  where s.enabled and s.leased_job_id is null
    and coalesce(s.cooldown_until,'-infinity'::timestamptz) <= clock_timestamp();
  claim_limit := least(greatest(coalesce(p_limit,1),1),1000,free_route_count);
  if claim_limit < 1 then return; end if;

  return query
  with eligible_jobs as materialized (
    select
      o.id as outbox_id,
      o.job_id,
      o.available_at,
      o.created_at,
      coalesce(
        j.dispatch_priority_class,
        case
          when exists (
            select 1
            from shorts_mvp.user_subscriptions subscription
            where subscription.user_id=j.user_id
              and subscription.status in ('active','trialing')
              and subscription.billing_cycle in ('monthly','yearly')
              and subscription.current_period_start <= clock_timestamp()
              and subscription.current_period_end > clock_timestamp()
          ) then 'paid'
          else 'free'
        end
      ) as priority_class
    from shorts_mvp.project_job_outbox o
    join shorts_mvp.video_jobs j on j.id=o.job_id
    where o.status='pending' and o.available_at <= clock_timestamp()
      and j.pipeline_version=2 and j.status='queued'
      and j.queue_expires_at > clock_timestamp()
  ), locked_jobs as materialized (
    select e.*
    from eligible_jobs e
    join shorts_mvp.project_job_outbox o on o.id=e.outbox_id
    order by
      case
        when e.priority_class='paid'
          or e.created_at <= clock_timestamp() - interval '15 minutes'
        then 0
        else 1
      end,
      e.available_at,e.created_at,e.outbox_id
    for update of o skip locked
    limit claim_limit
  ), numbered_jobs as materialized (
    select l.*,row_number() over (
      order by
        case
          when l.priority_class='paid'
            or l.created_at <= clock_timestamp() - interval '15 minutes'
          then 0
          else 1
        end,
        l.available_at,l.created_at,l.outbox_id
    ) as row_number
    from locked_jobs l
  ), locked_routes as materialized (
    select s.route_id,s.last_leased_at,quality.quality_tier
    from shorts_mvp.ingestion_route_slots s
    cross join lateral shorts_mvp.ingestion_route_quality(s.route_id) quality
    where s.enabled and s.leased_job_id is null
      and coalesce(s.cooldown_until,'-infinity'::timestamptz) <= clock_timestamp()
    order by
      case when success_priority_enabled then quality.quality_tier else 0 end,
      s.last_leased_at nulls first,
      s.route_id
    for update of s skip locked
    limit claim_limit
  ), numbered_routes as materialized (
    select l.*,row_number() over (
      order by
        case when success_priority_enabled then l.quality_tier else 0 end,
        l.last_leased_at nulls first,
        l.route_id
    ) as row_number
    from locked_routes l
  ), pairs as materialized (
    select j.outbox_id,j.job_id,j.priority_class,r.route_id
    from numbered_jobs j join numbered_routes r using (row_number)
  ), leased as materialized (
    update shorts_mvp.ingestion_route_slots s
    set leased_job_id=p.job_id,lease_expires_at=clock_timestamp() + interval '3 hours',
        cooldown_until=null,last_leased_at=clock_timestamp(),updated_at=clock_timestamp()
    from pairs p
    where s.route_id=p.route_id and s.leased_job_id is null
    returning s.route_id,s.leased_job_id
  ), assigned as materialized (
    update shorts_mvp.video_jobs j
    set ingestion_route_id=l.route_id,ingestion_route_leased_at=clock_timestamp(),
        dispatch_priority_class=coalesce(j.dispatch_priority_class,p.priority_class),
        deadline_at=clock_timestamp() + make_interval(
          mins => 30 + ceil((case
            when j.source_range_selection_enabled
              then j.range_end_seconds - j.range_start_seconds
            else j.source_duration_seconds
          end) / 60.0)::integer
        )
    from leased l
    join pairs p on p.job_id=l.leased_job_id and p.route_id=l.route_id
    where j.id=l.leased_job_id and j.pipeline_version=2 and j.status='queued'
    returning
      j.id,j.mvp_session_id,j.user_id,j.ingestion_route_id,
      j.dispatch_priority_class
  ), dispatched as materialized (
    update shorts_mvp.project_job_outbox o
    set status='dispatched',dispatched_at=clock_timestamp(),last_error=null
    from assigned j
    where o.job_id=j.id and o.status='pending'
    returning o.id,o.job_id
  )
  select
    d.id,d.job_id,j.ingestion_route_id,j.mvp_session_id,j.user_id,
    j.dispatch_priority_class
  from dispatched d join assigned j on j.id=d.job_id;
end;
$$;

revoke all on function shorts_mvp.claim_project_job_outbox(integer)
  from public, anon, authenticated;
grant execute on function shorts_mvp.claim_project_job_outbox(integer)
  to service_role;

commit;
