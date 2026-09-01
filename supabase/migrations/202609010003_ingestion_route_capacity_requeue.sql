begin;

alter table shorts_mvp.video_jobs
  add column if not exists ingestion_route_wait_started_at timestamptz,
  add column if not exists project_dispatch_generation integer not null default 0;

alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_project_dispatch_generation_check,
  add constraint video_jobs_project_dispatch_generation_check
    check (project_dispatch_generation between 0 and 1000);

create index if not exists video_jobs_ingestion_route_wait_idx
  on shorts_mvp.video_jobs (
    ingestion_route_wait_started_at,created_at,id
  )
  where pipeline_version=2
    and status='retry_waiting'
    and ingestion_route_wait_started_at is not null;

insert into shorts_mvp.runtime_feature_flags (
  flag_key,enabled,description
) values (
  'ingestion_capacity_requeue_v1',
  false,
  '빈 수집 경로가 없을 때 프로젝트를 실패시키지 않고 최대 1시간 FIFO 재대기'
)
on conflict (flag_key) do nothing;

comment on column shorts_mvp.video_jobs.ingestion_route_wait_started_at is
  'First route-capacity wait boundary; later deferrals never restart its one-hour budget';
comment on column shorts_mvp.video_jobs.project_dispatch_generation is
  'Monotonic project Batch generation used to reject delayed predecessor tasks';

create or replace function shorts_mvp.project_submission_key(
  p_job_id uuid,
  p_generation integer,
  p_resume boolean default false
)
returns text
language sql
immutable
security definer
set search_path=shorts_mvp,pg_temp
as $$
  select case
    when p_resume then 'project:' || p_job_id::text || ':resume:1'
    when greatest(coalesce(p_generation,0),0)=0
      then 'project:' || p_job_id::text || ':0'
    else 'project:' || p_job_id::text || ':generation:'
      || greatest(coalesce(p_generation,0),0)::text
  end;
$$;

create or replace function shorts_mvp.defer_project_for_ingestion_route(
  p_job_id uuid,
  p_expected_dispatch_generation integer,
  p_expected_batch_job_id text,
  p_attempted_route_ids text[] default array[]::text[]
)
returns table (
  action text,
  dispatch_generation integer,
  queue_expires_at timestamptz
)
language plpgsql
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  current_job shorts_mvp.video_jobs%rowtype;
  feature_enabled boolean := false;
  wait_started_at timestamptz;
  wait_expires_at timestamptz;
begin
  select coalesce(flag.enabled,false) into feature_enabled
  from shorts_mvp.runtime_feature_flags flag
  where flag.flag_key='ingestion_capacity_requeue_v1'
  for share;

  if not coalesce(feature_enabled,false) then
    return query select 'disabled'::text,
      greatest(coalesce(p_expected_dispatch_generation,0),0),null::timestamptz;
    return;
  end if;

  select * into current_job
  from shorts_mvp.video_jobs
  where id=p_job_id
  for update;

  if not found
    or nullif(btrim(coalesce(p_expected_batch_job_id,'')),'') is null
    or current_job.pipeline_version<>2
    or current_job.source_type='upload'
    or current_job.preparation_finished_at is not null
    or current_job.status<>'downloading'
    or current_job.project_dispatch_generation
      is distinct from p_expected_dispatch_generation
    or current_job.aws_batch_job_id is distinct from p_expected_batch_job_id
  then
    return query select 'stale'::text,
      coalesce(current_job.project_dispatch_generation,0),
      current_job.queue_expires_at;
    return;
  end if;

  update shorts_mvp.ingestion_route_slots route
  set leased_job_id=null,
      lease_expires_at=null,
      last_job_id=p_job_id,
      last_result='capacity_wait',
      last_released_at=clock_timestamp(),
      updated_at=clock_timestamp()
  where route.leased_job_id=p_job_id;

  wait_started_at := coalesce(
    current_job.ingestion_route_wait_started_at,
    clock_timestamp()
  );
  wait_expires_at := wait_started_at + interval '1 hour';

  if wait_expires_at<=clock_timestamp() then
    update shorts_mvp.project_job_outbox
    set status='failed',
        last_error='ingestion_capacity_timeout'
    where job_id=p_job_id and status<>'failed';
    perform shorts_mvp.finalize_project_job(
      p_job_id,
      'ingestion_capacity_timeout',
      '현재 원본 영상 처리 요청이 많아 작업을 시작하지 못했습니다.'
    );
    update shorts_mvp.video_jobs
    set error_message=(
      '현재 원본 영상 처리 요청이 많아 작업을 시작하지 못했습니다. '
      '사용량은 복구되었습니다. 다시 시도해 주세요.'
    )
    where id=p_job_id and status='failed';
    return query select 'expired'::text,
      current_job.project_dispatch_generation,wait_expires_at;
    return;
  end if;

  update shorts_mvp.video_jobs job
  set status='retry_waiting',
      stage='downloading',
      progress=10,
      stage_completed_count=0,
      stage_total_count=0,
      next_attempt_at=null,
      ingestion_route_id=null,
      ingestion_route_leased_at=null,
      ingestion_route_wait_started_at=wait_started_at,
      project_dispatch_generation=job.project_dispatch_generation+1,
      queue_expires_at=wait_expires_at,
      deadline_at=greatest(
        job.deadline_at,
        wait_expires_at + interval '5 minutes'
      ),
      aws_batch_job_id=null,
      error_code=null,
      error_message=null,
      error_details='{}'::jsonb,
      heartbeat_at=clock_timestamp()
  where job.id=p_job_id;

  update shorts_mvp.project_job_outbox outbox
  set status='pending',
      dispatched_at=null,
      last_error=null
  where outbox.job_id=p_job_id;

  insert into shorts_mvp.job_events (
    job_id,stage,progress,message,metadata
  ) values (
    p_job_id,
    'retry_waiting',
    10,
    '원본 영상을 준비하고 있습니다.',
    jsonb_build_object(
      'reason','ingestion_route_capacity',
      'waitStartedAt',wait_started_at,
      'waitExpiresAt',wait_expires_at,
      'dispatchGeneration',current_job.project_dispatch_generation+1,
      'attemptedRouteCount',cardinality(
        coalesce(p_attempted_route_ids,array[]::text[])
      )
    )
  );

  return query select 'deferred'::text,
    current_job.project_dispatch_generation+1,wait_expires_at;
end;
$$;

drop function if exists shorts_mvp.claim_project_job_outbox(integer);
drop function if exists
  shorts_mvp.claim_project_job_outbox_without_ingestion_circuit(integer);

create function shorts_mvp.claim_project_job_outbox_without_ingestion_circuit(
  p_limit integer default 100
)
returns table (
  outbox_id uuid,
  job_id uuid,
  route_id text,
  mvp_session_id uuid,
  user_id uuid,
  priority_class text,
  dispatch_generation integer
)
language plpgsql
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  free_route_count integer;
  claim_limit integer;
  success_priority_enabled boolean := false;
  capacity_requeue_enabled boolean := false;
begin
  with released as (
    update shorts_mvp.ingestion_route_slots route
    set leased_job_id=null,
        lease_expires_at=null,
        last_job_id=route.leased_job_id,
        last_result='batch_failed',
        last_released_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where route.leased_job_id is not null and (
      route.lease_expires_at<=clock_timestamp()
      or not exists (
        select 1
        from shorts_mvp.video_jobs job
        where job.id=route.leased_job_id
          and job.ingestion_route_id=route.route_id
          and job.status not in ('completed','failed','expired','deleted')
      )
    )
    returning route.last_job_id,route.route_id
  )
  update shorts_mvp.video_jobs job
  set ingestion_route_id=null,
      ingestion_route_leased_at=null
  where exists (
    select 1
    from released
    where released.last_job_id=job.id
      and released.route_id=job.ingestion_route_id
  );

  select coalesce((
    select flag.enabled
    from shorts_mvp.runtime_feature_flags flag
    where flag.flag_key='ingestion_success_priority'
  ),false) into success_priority_enabled;

  select coalesce((
    select flag.enabled
    from shorts_mvp.runtime_feature_flags flag
    where flag.flag_key='ingestion_capacity_requeue_v1'
  ),false) into capacity_requeue_enabled;

  select count(*)::integer into free_route_count
  from shorts_mvp.ingestion_route_slots route
  where route.enabled
    and route.leased_job_id is null
    and coalesce(route.cooldown_until,'-infinity'::timestamptz)
      <=clock_timestamp();
  claim_limit := least(
    greatest(coalesce(p_limit,1),1),1000,free_route_count
  );
  if claim_limit<1 then return; end if;

  return query
  with eligible_jobs as materialized (
    select
      outbox.id as outbox_id,
      outbox.job_id,
      outbox.available_at,
      outbox.created_at as outbox_created_at,
      job.created_at as job_created_at,
      job.project_dispatch_generation,
      coalesce(
        job.dispatch_priority_class,
        case when exists (
          select 1
          from shorts_mvp.user_subscriptions subscription
          where subscription.user_id=job.user_id
            and subscription.status in ('active','trialing')
            and subscription.billing_cycle in ('monthly','yearly')
            and subscription.current_period_start<=clock_timestamp()
            and subscription.current_period_end>clock_timestamp()
        ) then 'paid' else 'free' end
      ) as priority_class
    from shorts_mvp.project_job_outbox outbox
    join shorts_mvp.video_jobs job on job.id=outbox.job_id
    where outbox.status='pending'
      and outbox.available_at<=clock_timestamp()
      and job.pipeline_version=2
      and (
        job.status='queued'
        or (
          capacity_requeue_enabled
          and
          job.status='retry_waiting'
          and job.ingestion_route_wait_started_at is not null
        )
      )
      and job.queue_expires_at>clock_timestamp()
  ), locked_jobs as materialized (
    select eligible.*
    from eligible_jobs eligible
    join shorts_mvp.project_job_outbox outbox
      on outbox.id=eligible.outbox_id
    order by
      case when eligible.priority_class='paid'
        or eligible.job_created_at<=clock_timestamp()-interval '15 minutes'
        then 0 else 1 end,
      eligible.job_created_at,
      eligible.outbox_created_at,
      eligible.outbox_id
    for update of outbox skip locked
    limit claim_limit
  ), numbered_jobs as materialized (
    select locked.*,row_number() over (
      order by
        case when locked.priority_class='paid'
          or locked.job_created_at<=clock_timestamp()-interval '15 minutes'
          then 0 else 1 end,
        locked.job_created_at,
        locked.outbox_created_at,
        locked.outbox_id
    ) as row_number
    from locked_jobs locked
  ), locked_routes as materialized (
    select route.route_id,route.last_leased_at,quality.quality_tier
    from shorts_mvp.ingestion_route_slots route
    cross join lateral shorts_mvp.ingestion_route_quality(route.route_id) quality
    where route.enabled
      and route.leased_job_id is null
      and coalesce(route.cooldown_until,'-infinity'::timestamptz)
        <=clock_timestamp()
    order by
      case when success_priority_enabled then quality.quality_tier else 0 end,
      route.last_leased_at nulls first,
      route.route_id
    for update of route skip locked
    limit claim_limit
  ), numbered_routes as materialized (
    select locked.*,row_number() over (
      order by
        case when success_priority_enabled then locked.quality_tier else 0 end,
        locked.last_leased_at nulls first,
        locked.route_id
    ) as row_number
    from locked_routes locked
  ), pairs as materialized (
    select
      job.outbox_id,
      job.job_id,
      job.priority_class,
      job.project_dispatch_generation,
      route.route_id
    from numbered_jobs job
    join numbered_routes route using (row_number)
  ), leased as materialized (
    update shorts_mvp.ingestion_route_slots route
    set leased_job_id=pair.job_id,
        lease_expires_at=clock_timestamp()+interval '3 hours',
        cooldown_until=null,
        last_leased_at=clock_timestamp(),
        updated_at=clock_timestamp()
    from pairs pair
    where route.route_id=pair.route_id
      and route.leased_job_id is null
    returning route.route_id,route.leased_job_id
  ), assigned as materialized (
    update shorts_mvp.video_jobs job
    set ingestion_route_id=leased.route_id,
        ingestion_route_leased_at=clock_timestamp(),
        dispatch_priority_class=coalesce(
          job.dispatch_priority_class,pair.priority_class
        ),
        deadline_at=clock_timestamp()+make_interval(
          mins=>30+ceil((case
            when job.source_range_selection_enabled
              then job.range_end_seconds-job.range_start_seconds
            else job.source_duration_seconds
          end)/60.0)::integer
        )
    from leased
    join pairs pair
      on pair.job_id=leased.leased_job_id
      and pair.route_id=leased.route_id
    where job.id=leased.leased_job_id
      and job.pipeline_version=2
      and (
        job.status='queued'
        or (
          capacity_requeue_enabled
          and
          job.status='retry_waiting'
          and job.ingestion_route_wait_started_at is not null
        )
      )
    returning
      job.id,
      job.mvp_session_id,
      job.user_id,
      job.ingestion_route_id,
      job.dispatch_priority_class,
      job.project_dispatch_generation
  ), dispatched as materialized (
    update shorts_mvp.project_job_outbox outbox
    set status='dispatched',
        dispatched_at=clock_timestamp(),
        last_error=null
    from assigned job
    where outbox.job_id=job.id
      and outbox.status='pending'
    returning outbox.id,outbox.job_id
  )
  select
    dispatched.id,
    dispatched.job_id,
    job.ingestion_route_id,
    job.mvp_session_id,
    job.user_id,
    job.dispatch_priority_class,
    job.project_dispatch_generation
  from dispatched
  join assigned job on job.id=dispatched.job_id;
end;
$$;

create function shorts_mvp.claim_project_job_outbox(
  p_limit integer default 100
)
returns table (
  outbox_id uuid,
  job_id uuid,
  route_id text,
  mvp_session_id uuid,
  user_id uuid,
  priority_class text,
  dispatch_generation integer
)
language plpgsql
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  circuit_reason text;
  circuit_blocked_until timestamptz;
begin
  select reason,blocked_until
  into circuit_reason,circuit_blocked_until
  from shorts_mvp.ingestion_circuit
  where singleton
  for update;

  if circuit_reason='bot_check_active'
    or (
      circuit_reason='bot_check_rate'
      and (
        circuit_blocked_until is null
        or circuit_blocked_until<=clock_timestamp()
      )
    )
  then
    update shorts_mvp.ingestion_circuit
    set blocked_until=null,reason=null,updated_at=clock_timestamp()
    where singleton;
    circuit_reason:=null;
  end if;

  if circuit_reason is not null then
    update shorts_mvp.video_jobs job
    set queue_expires_at=greatest(
      job.queue_expires_at,
      clock_timestamp()+interval '24 hours'
    )
    where job.pipeline_version=2
      and job.status='queued'
      and job.ingestion_route_wait_started_at is null
      and exists (
        select 1
        from shorts_mvp.project_job_outbox outbox
        where outbox.job_id=job.id and outbox.status='pending'
      );
    return;
  end if;

  return query
  select *
  from shorts_mvp.claim_project_job_outbox_without_ingestion_circuit(p_limit);
end;
$$;

create or replace function shorts_mvp.complete_project_batch_submission_target(
  p_submission_key text,
  p_video_job_id uuid,
  p_expected_batch_target_key text,
  p_expected_batch_target_release_id text,
  p_observed_job_definition text,
  p_observed_job_queue text,
  p_aws_batch_job_id text,
  p_job_definition text,
  p_job_queue text
)
returns boolean
language plpgsql
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  current_claim shorts_mvp.batch_submission_claims%rowtype;
  current_job shorts_mvp.video_jobs%rowtype;
  expected_submission_key text;
begin
  if nullif(btrim(p_aws_batch_job_id),'') is null
    or nullif(btrim(p_job_definition),'') is null
    or nullif(btrim(p_job_queue),'') is null
    or ((p_expected_batch_target_key is null)
      is distinct from (p_expected_batch_target_release_id is null))
    or ((p_observed_job_definition is null)
      is distinct from (p_observed_job_queue is null))
  then return false; end if;

  select * into current_job
  from shorts_mvp.video_jobs
  where id=p_video_job_id
  for update;
  if not found then return false; end if;

  expected_submission_key:=shorts_mvp.project_submission_key(
    p_video_job_id,
    current_job.project_dispatch_generation,
    current_job.project_resume_count=1
      and current_job.preparation_finished_at is not null
  );
  if p_submission_key is distinct from expected_submission_key then
    return false;
  end if;

  select * into current_claim
  from shorts_mvp.batch_submission_claims
  where submission_key=p_submission_key
  for update;
  if not found then return false; end if;

  if current_claim.aws_batch_job_id is not null
      and current_claim.aws_batch_job_id is distinct from p_aws_batch_job_id
    or current_claim.job_definition is not null
      and current_claim.job_definition is distinct from p_job_definition
    or current_claim.job_queue is not null
      and current_claim.job_queue is distinct from p_job_queue
    or current_job.aws_batch_job_id is not null
      and current_job.aws_batch_job_id is distinct from p_aws_batch_job_id
    or current_job.batch_target_key
      is distinct from p_expected_batch_target_key
    or current_job.batch_target_release_id
      is distinct from p_expected_batch_target_release_id
    or current_job.batch_job_definition
      is distinct from p_observed_job_definition
    or current_job.batch_job_queue
      is distinct from p_observed_job_queue
  then return false; end if;

  update shorts_mvp.batch_submission_claims
  set aws_batch_job_id=coalesce(aws_batch_job_id,p_aws_batch_job_id),
      job_definition=coalesce(job_definition,p_job_definition),
      job_queue=coalesce(job_queue,p_job_queue),
      completed_at=coalesce(completed_at,clock_timestamp()),
      updated_at=clock_timestamp()
  where submission_key=p_submission_key;

  update shorts_mvp.video_jobs
  set aws_batch_job_id=p_aws_batch_job_id,
      batch_job_definition=p_job_definition,
      batch_job_queue=p_job_queue
  where id=p_video_job_id;
  return true;
end;
$$;

create or replace function shorts_mvp.fail_video_job_at_deadline(p_job_id uuid)
returns table (failed boolean)
language plpgsql
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  current_job shorts_mvp.video_jobs%rowtype;
  failure_code text;
  internal_message text;
  public_message text;
begin
  select * into current_job
  from shorts_mvp.video_jobs
  where id=p_job_id
  for update;
  if not found
    or current_job.status in ('completed','failed','expired','deleted')
    or (
      current_job.status in ('queued','retry_waiting')
      and current_job.queue_expires_at>clock_timestamp()
    )
    or (
      current_job.status not in ('queued','retry_waiting')
      and current_job.deadline_at>clock_timestamp()
    )
  then return query select false; return; end if;

  failure_code:=case
    when current_job.status='retry_waiting'
      and current_job.ingestion_route_wait_started_at is not null
      then 'ingestion_capacity_timeout'
    else 'job_deadline'
  end;
  internal_message:=case when failure_code='ingestion_capacity_timeout'
    then '원본 영상 처리 경로를 한 시간 안에 확보하지 못했습니다.'
    else '쇼츠를 만드는 중 작업 제한 시간이 종료되었습니다.'
  end;
  public_message:=case when failure_code='ingestion_capacity_timeout'
    then (
      '현재 원본 영상 처리 요청이 많아 작업을 시작하지 못했습니다. '
      '사용량은 복구되었습니다. 다시 시도해 주세요.'
    )
    else '쇼츠를 만드는 중 작업 제한 시간이 종료되었습니다. 다시 시도해 주세요.'
  end;

  if current_job.ingestion_route_id is not null then
    perform shorts_mvp.release_ingestion_route(
      p_job_id,current_job.ingestion_route_id,'deadline',0
    );
  end if;
  if current_job.pipeline_version=2 then
    update shorts_mvp.project_output_attempts
    set status='failed',
        failure_stage='deadline',
        failure_code=failure_code,
        failure_message=internal_message,
        failed_at=coalesce(failed_at,clock_timestamp())
    where job_id=p_job_id and status not in ('ready','failed');
    perform shorts_mvp.finalize_project_job(
      p_job_id,failure_code,internal_message
    );
    update shorts_mvp.video_jobs
    set error_message=public_message
    where id=p_job_id and status='failed';
  else
    update shorts_mvp.video_jobs
    set status='failed',stage='failed',progress=100,
        error_code=failure_code,error_message=public_message,
        source_deleted_at=clock_timestamp(),heartbeat_at=clock_timestamp()
    where id=p_job_id;
    update shorts_mvp.usage_reservations
    set status='released',released_at=clock_timestamp()
    where job_id=p_job_id and status='reserved';
    update shorts_mvp.generated_shorts
    set status='failed',render_progress=0,
        render_error_code=failure_code,
        render_error_message=public_message
    where job_id=p_job_id
      and status in ('rendering','rerendering','ready')
      and deleted_at is null;
    insert into shorts_mvp.job_events (job_id,stage,progress,message)
    values (p_job_id,'failed',100,public_message);
  end if;

  update shorts_mvp.project_job_outbox
  set status='failed',last_error=failure_code
  where job_id=p_job_id and status<>'failed';
  return query select true;
end;
$$;

create or replace function shorts_mvp.get_batch_dispatch_health()
returns table (
  actionable_queued_without_batch_id bigint,
  oldest_actionable_at timestamptz,
  oldest_actionable_age_seconds bigint,
  submission_claim_without_job_id bigint,
  oldest_submission_claim_at timestamptz,
  oldest_submission_claim_age_seconds bigint
)
language sql
stable
security definer
set search_path=shorts_mvp,pg_temp
as $$
  with actionable as (
    select coalesce(
      outbox.dispatched_at,outbox.available_at,outbox.created_at
    ) as actionable_at
    from shorts_mvp.video_jobs job
    join shorts_mvp.project_job_outbox outbox on outbox.job_id=job.id
    where job.execution_backend='aws_batch'
      and job.pipeline_version=2
      and job.status in ('queued','retry_waiting')
      and job.aws_batch_job_id is null
      and job.queue_expires_at>statement_timestamp()
      and (outbox.status='dispatched' or outbox.last_error is not null)
      and coalesce(
        outbox.dispatched_at,outbox.available_at,outbox.created_at
      )<=statement_timestamp()-interval '5 minutes'
  ), claim_mismatch as (
    select coalesce(
      claim.completed_at,claim.updated_at,claim.claimed_at
    ) as actionable_at
    from shorts_mvp.video_jobs job
    join shorts_mvp.batch_submission_claims claim
      on claim.submission_key=shorts_mvp.project_submission_key(
        job.id,
        job.project_dispatch_generation,
        job.project_resume_count=1 and job.status='rendering'
      )
    where job.pipeline_version=2
      and job.status not in ('completed','failed','expired','deleted')
      and (
        claim.aws_batch_job_id is null
        or job.aws_batch_job_id is distinct from claim.aws_batch_job_id
        or ((job.batch_job_definition is null)
          is distinct from (job.batch_job_queue is null))
        or (job.aws_batch_job_id is not null
          and job.batch_job_definition is null)
        or ((claim.job_definition is null)
          is distinct from (claim.job_queue is null))
        or (claim.job_definition is not null and (
          job.batch_job_definition is distinct from claim.job_definition
          or job.batch_job_queue is distinct from claim.job_queue
        ))
      )
      and coalesce(
        claim.completed_at,claim.updated_at,claim.claimed_at
      )<=statement_timestamp()-interval '5 minutes'
  )
  select
    count(*)::bigint,
    min(actionable_at),
    case when min(actionable_at) is null then null::bigint
      else greatest(0,floor(extract(epoch from (
        statement_timestamp()-min(actionable_at)
      )))::bigint) end,
    (select count(*)::bigint from claim_mismatch),
    (select min(actionable_at) from claim_mismatch),
    case when (select min(actionable_at) from claim_mismatch) is null
      then null::bigint
      else greatest(0,floor(extract(epoch from (
        statement_timestamp()-(select min(actionable_at) from claim_mismatch)
      )))::bigint) end
  from actionable;
$$;

create or replace function shorts_mvp.project_target_successor_drain()
returns jsonb
language sql
security definer
set search_path=shorts_mvp,pg_temp
as $$
  with operation as (
    select render_v4_target_successor as value
    from shorts_mvp.editor_release_state
    where singleton
  ), active_jobs as (
    select job.*
    from shorts_mvp.video_jobs job
    where job.pipeline_version=2
      and job.source_type is distinct from 'upload'
      and job.status not in ('completed','failed','expired','deleted')
  )
  select jsonb_build_object(
    'unsubmittedJobs',(select count(*) from active_jobs
      where nullif(aws_batch_job_id,'') is null),
    'pendingOutbox',(select count(*)
      from shorts_mvp.project_job_outbox outbox
      join active_jobs job on job.id=outbox.job_id
      where outbox.status='pending'),
    'unsubmittedClaims',(select count(*)
      from shorts_mvp.batch_submission_claims claim
      where claim.submission_key like 'project:%' and (
        nullif(claim.aws_batch_job_id,'') is null
        or exists (
          select 1 from active_jobs job
          where claim.submission_key=shorts_mvp.project_submission_key(
            job.id,
            job.project_dispatch_generation,
            job.project_resume_count=1
          )
            and claim.aws_batch_job_id is distinct from job.aws_batch_job_id
        )
      )),
    'olderGenerationJobs',(select count(*)
      from active_jobs job,operation
      where not exists (
        select 1
        from jsonb_each(operation.value->'oldRegistry'->'lanes') lane
        where job.batch_job_definition=lane.value->'current'->>'jobDefinitionArn'
          and job.batch_job_queue=lane.value->'current'->>'jobQueueArn'
          and (
            job.batch_target_key is null
            or (
              job.batch_target_key=lane.key
              and job.batch_target_release_id=lane.value->'current'->>'releaseId'
            )
          )
      ))
  );
$$;

revoke all on function shorts_mvp.project_submission_key(uuid,integer,boolean)
  from public,anon,authenticated;
revoke all on function shorts_mvp.defer_project_for_ingestion_route(
  uuid,integer,text,text[]
) from public,anon,authenticated;
revoke all on function shorts_mvp.claim_project_job_outbox_without_ingestion_circuit(integer)
  from public,anon,authenticated;
revoke all on function shorts_mvp.claim_project_job_outbox(integer)
  from public,anon,authenticated;
revoke all on function shorts_mvp.complete_project_batch_submission_target(
  text,uuid,text,text,text,text,text,text,text
) from public,anon,authenticated;
revoke all on function shorts_mvp.fail_video_job_at_deadline(uuid)
  from public,anon,authenticated;
revoke all on function shorts_mvp.get_batch_dispatch_health()
  from public,anon,authenticated;
revoke all on function shorts_mvp.project_target_successor_drain()
  from public,anon,authenticated;

grant execute on function shorts_mvp.project_submission_key(uuid,integer,boolean)
  to service_role;
grant execute on function shorts_mvp.defer_project_for_ingestion_route(
  uuid,integer,text,text[]
) to service_role;
grant execute on function shorts_mvp.claim_project_job_outbox(integer)
  to service_role;
grant execute on function shorts_mvp.complete_project_batch_submission_target(
  text,uuid,text,text,text,text,text,text,text
) to service_role;
grant execute on function shorts_mvp.fail_video_job_at_deadline(uuid)
  to service_role;
grant execute on function shorts_mvp.get_batch_dispatch_health()
  to service_role;
grant execute on function shorts_mvp.project_target_successor_drain()
  to service_role;

commit;
