begin;

alter table shorts_mvp.video_jobs
  add column if not exists dispatch_priority_class text;

alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_dispatch_priority_class_check;
alter table shorts_mvp.video_jobs
  add constraint video_jobs_dispatch_priority_class_check check (
    dispatch_priority_class is null
    or dispatch_priority_class in ('paid','free')
  );

comment on column shorts_mvp.video_jobs.dispatch_priority_class is
  'Immutable paid/free scheduling snapshot, assigned before the first Batch submission.';

-- Preserve the entitlement of work that is already in flight before the new
-- dispatcher is deployed. Terminal rows remain untouched.
update shorts_mvp.video_jobs j
set dispatch_priority_class = case
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
where j.dispatch_priority_class is null
  and j.status not in ('completed','failed','expired','deleted');

-- The return shape changes to include the scheduling snapshot. Dropping and
-- recreating inside this transaction makes the API change atomic to callers.
drop function if exists shorts_mvp.claim_project_job_outbox(integer);

create function shorts_mvp.claim_project_job_outbox(p_limit integer default 100)
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
    select s.route_id,s.last_leased_at
    from shorts_mvp.ingestion_route_slots s
    where s.enabled and s.leased_job_id is null
      and coalesce(s.cooldown_until,'-infinity'::timestamptz) <= clock_timestamp()
    order by s.last_leased_at nulls first,s.route_id
    for update of s skip locked
    limit claim_limit
  ), numbered_routes as materialized (
    select l.*,row_number() over (
      order by l.last_leased_at nulls first,l.route_id
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
          mins => 30 + ceil(j.source_duration_seconds / 60.0)::integer
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
