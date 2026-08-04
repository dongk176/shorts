begin;

alter table shorts_mvp.youtube_analyses
  add column if not exists source_range_selection_enabled boolean not null default false;

alter table shorts_mvp.video_jobs
  add column if not exists source_range_selection_enabled boolean not null default false,
  add column if not exists batch_job_queue text,
  add column if not exists normalized_source_start_seconds numeric(12,3);

alter table shorts_mvp.youtube_analyses
  drop constraint if exists youtube_analyses_duration_seconds_check;
alter table shorts_mvp.youtube_analyses
  add constraint youtube_analyses_duration_seconds_check check (duration_seconds > 0);

alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_source_duration_seconds_check,
  drop constraint if exists video_jobs_source_range_selection_check;
alter table shorts_mvp.video_jobs
  add constraint video_jobs_source_duration_seconds_check check (source_duration_seconds > 0),
  add constraint video_jobs_source_range_selection_check check (
    not source_range_selection_enabled
    or (
      range_start_seconds >= 0
      and range_end_seconds <= source_duration_seconds
      and range_end_seconds - range_start_seconds between 240 and 3600
    )
  );

alter table shorts_mvp.usage_reservations
  drop constraint if exists usage_reservations_source_duration_seconds_check;
alter table shorts_mvp.usage_reservations
  add constraint usage_reservations_source_duration_seconds_check check (source_duration_seconds > 0);

alter table shorts_mvp.usage_events
  drop constraint if exists usage_events_source_duration_seconds_check;
alter table shorts_mvp.usage_events
  add constraint usage_events_source_duration_seconds_check check (source_duration_seconds > 0);

insert into shorts_mvp.runtime_feature_flags (flag_key,enabled,description)
values (
  'source_range_selection',
  false,
  '4분 이상 원본의 4~60분 구간 선택과 전용 AWS Batch 워커 라우팅'
)
on conflict (flag_key) do nothing;

-- Keep queue assignment, entitlement priority, and route leasing identical to
-- production while calculating the execution deadline from the selected range.
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

comment on column shorts_mvp.youtube_analyses.source_range_selection_enabled is
  'Immutable source-range eligibility snapshot captured when the analysis was created';
comment on column shorts_mvp.video_jobs.batch_job_queue is
  'Exact AWS Batch queue ARN pinned when the job is created';
comment on column shorts_mvp.video_jobs.normalized_source_start_seconds is
  'Absolute source timestamp represented by 0 seconds in the normalized downloaded media';

commit;
