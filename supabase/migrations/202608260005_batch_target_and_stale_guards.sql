begin;

set local lock_timeout = '3s';

-- Logical targets are nullable so jobs created before this release retain their
-- exact raw Batch definition/queue provenance. New dispatchers write both
-- values together and resolve them through the production target registry.
alter table shorts_mvp.video_jobs
  add column if not exists batch_target_key text,
  add column if not exists batch_target_release_id text;

alter table shorts_mvp.batch_submission_claims
  add column if not exists job_definition text,
  add column if not exists job_queue text;

alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_batch_target_pair_check,
  drop constraint if exists video_jobs_batch_target_key_check,
  drop constraint if exists video_jobs_batch_target_release_id_check;

alter table shorts_mvp.video_jobs
  add constraint video_jobs_batch_target_pair_check check (
    (batch_target_key is null)=(batch_target_release_id is null)
  ) not valid,
  add constraint video_jobs_batch_target_key_check check (
    batch_target_key is null
    or batch_target_key ~ '^[a-z0-9][a-z0-9._-]{2,127}$'
  ) not valid,
  add constraint video_jobs_batch_target_release_id_check check (
    batch_target_release_id is null
    or batch_target_release_id ~ '^[a-z0-9][a-z0-9._-]{2,127}$'
  ) not valid;

alter table shorts_mvp.batch_submission_claims
  drop constraint if exists batch_submission_claims_target_pair_check,
  add constraint batch_submission_claims_target_pair_check check (
    (job_definition is null)=(job_queue is null)
  ) not valid;

comment on column shorts_mvp.video_jobs.batch_target_key is
  'Logical Batch lane key. Null preserves legacy jobs pinned to their stored raw target.';
comment on column shorts_mvp.video_jobs.batch_target_release_id is
  'Immutable release identifier resolved through the production Batch target registry.';
comment on column shorts_mvp.video_jobs.batch_job_definition is
  'Exact AWS Batch definition actually submitted. Legacy rows may contain the creation-time pin.';
comment on column shorts_mvp.video_jobs.batch_job_queue is
  'Exact AWS Batch queue actually submitted. Legacy rows may contain the creation-time pin.';
comment on column shorts_mvp.batch_submission_claims.job_definition is
  'Immutable Batch definition resolved before the idempotent submission claim.';
comment on column shorts_mvp.batch_submission_claims.job_queue is
  'Immutable Batch queue resolved before the idempotent submission claim.';

-- New submissions bind the idempotency claim to the resolved target before
-- calling AWS. The legacy two-argument RPC remains available to the currently
-- deployed Lambda during the additive rollout.
create or replace function shorts_mvp.claim_batch_submission_target(
  p_submission_key text,
  p_job_name text,
  p_job_definition text,
  p_job_queue text
)
returns table (
  action text,
  aws_batch_job_id text,
  job_definition text,
  job_queue text
)
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  inserted_count integer;
  current_claim shorts_mvp.batch_submission_claims%rowtype;
begin
  if nullif(btrim(p_job_definition),'') is null
    or nullif(btrim(p_job_queue),'') is null then
    return query select
      'invalid_target'::text,null::text,null::text,null::text;
    return;
  end if;

  insert into shorts_mvp.batch_submission_claims (
    submission_key,job_name,job_definition,job_queue
  ) values (
    p_submission_key,p_job_name,p_job_definition,p_job_queue
  ) on conflict (submission_key) do nothing;
  get diagnostics inserted_count = row_count;

  select * into current_claim
  from shorts_mvp.batch_submission_claims
  where submission_key=p_submission_key
  for update;

  if (current_claim.job_definition is null)
      is distinct from (current_claim.job_queue is null) then
    return query select
      'invalid_target'::text,current_claim.aws_batch_job_id,
      current_claim.job_definition,current_claim.job_queue;
    return;
  end if;

  if current_claim.job_definition is not null and (
    current_claim.job_definition is distinct from p_job_definition
    or current_claim.job_queue is distinct from p_job_queue
  ) then
    return query select
      'target_mismatch'::text,current_claim.aws_batch_job_id,
      current_claim.job_definition,current_claim.job_queue;
    return;
  end if;

  if current_claim.aws_batch_job_id is not null then
    return query select
      'existing'::text,current_claim.aws_batch_job_id,
      current_claim.job_definition,current_claim.job_queue;
    return;
  end if;

  if inserted_count = 0
    and current_claim.claimed_at > clock_timestamp() - interval '90 seconds' then
    return query select
      'busy'::text,null::text,
      current_claim.job_definition,current_claim.job_queue;
    return;
  end if;

  update shorts_mvp.batch_submission_claims claim
  set job_name=p_job_name,
      job_definition=coalesce(claim.job_definition,p_job_definition),
      job_queue=coalesce(claim.job_queue,p_job_queue),
      claimed_at=clock_timestamp(),updated_at=clock_timestamp()
  where submission_key=p_submission_key;

  return query select
    'claimed'::text,null::text,p_job_definition,p_job_queue;
end;
$$;

create or replace function shorts_mvp.complete_batch_submission_target(
  p_submission_key text,
  p_aws_batch_job_id text,
  p_job_definition text,
  p_job_queue text
)
returns boolean
language sql
security definer
set search_path = shorts_mvp, pg_temp
as $$
  update shorts_mvp.batch_submission_claims
  set aws_batch_job_id=coalesce(aws_batch_job_id,p_aws_batch_job_id),
      job_definition=coalesce(job_definition,p_job_definition),
      job_queue=coalesce(job_queue,p_job_queue),
      completed_at=coalesce(completed_at,clock_timestamp()),
      updated_at=clock_timestamp()
  where submission_key=p_submission_key
    and (aws_batch_job_id is null or aws_batch_job_id=p_aws_batch_job_id)
    and (job_definition is null or job_definition=p_job_definition)
    and (job_queue is null or job_queue=p_job_queue)
  returning true;
$$;

-- Project submissions must not expose a completed idempotency claim before
-- the owning video_jobs row has the same immutable AWS target. The creation-
-- time raw pair is part of the CAS so a validated previous -> current remap can
-- still complete after EventBridge records the Batch id first. Lock and bind
-- both rows in one PostgreSQL transaction; status transitions are deliberately
-- not part of the CAS because AWS may move queued -> starting immediately.
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
set search_path = shorts_mvp, pg_temp
as $$
declare
  current_claim shorts_mvp.batch_submission_claims%rowtype;
  current_job shorts_mvp.video_jobs%rowtype;
begin
  if nullif(btrim(p_aws_batch_job_id),'') is null
    or nullif(btrim(p_job_definition),'') is null
    or nullif(btrim(p_job_queue),'') is null
    or ((p_expected_batch_target_key is null)
        is distinct from (p_expected_batch_target_release_id is null))
    or ((p_observed_job_definition is null)
        is distinct from (p_observed_job_queue is null))
    or p_submission_key not in (
      'project:' || p_video_job_id::text || ':0',
      'project:' || p_video_job_id::text || ':resume:1'
    ) then
    return false;
  end if;

  select * into current_claim
  from shorts_mvp.batch_submission_claims
  where submission_key=p_submission_key
  for update;
  if not found then return false; end if;

  select * into current_job
  from shorts_mvp.video_jobs
  where id=p_video_job_id
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
      is distinct from p_observed_job_queue then
    return false;
  end if;

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

-- Final stale-job ownership is claimed inside PostgreSQL. The cleanup Lambda
-- may inspect AWS before this call, but it cannot finalize a row if a worker or
-- recovery submission changed the observed Batch id, status, or heartbeat.
create or replace function shorts_mvp.finalize_stale_video_job_if_unchanged(
  p_job_id uuid,
  p_observed_aws_batch_job_id text,
  p_observed_status text,
  p_observed_heartbeat_at timestamptz,
  p_created_before timestamptz,
  p_heartbeat_before timestamptz
)
returns table (
  finalized boolean,
  reason text,
  final_status text
)
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  current_job shorts_mvp.video_jobs%rowtype;
  resulting_status text;
  stale_error_code constant text := 'stale_job';
  stale_internal_message constant text :=
    '작업 heartbeat가 2시간 이상 중단되었습니다.';
begin
  if p_created_before is null or p_heartbeat_before is null then
    return query select false,'invalid_cutoff'::text,null::text;
    return;
  end if;

  select * into current_job
  from shorts_mvp.video_jobs
  where id=p_job_id
  for update;

  if not found then
    return query select false,'missing'::text,null::text;
    return;
  end if;

  if current_job.status in ('completed','failed','expired','deleted') then
    return query select false,'terminal'::text,current_job.status;
    return;
  end if;

  if current_job.aws_batch_job_id is distinct from p_observed_aws_batch_job_id
    or current_job.status is distinct from p_observed_status
    or current_job.heartbeat_at is distinct from p_observed_heartbeat_at then
    return query select false,'observation_changed'::text,current_job.status;
    return;
  end if;

  if current_job.created_at >= p_created_before then
    return query select false,'job_too_new'::text,current_job.status;
    return;
  end if;

  if current_job.heartbeat_at is not null
    and current_job.heartbeat_at >= p_heartbeat_before then
    return query select false,'recent_heartbeat'::text,current_job.status;
    return;
  end if;

  if current_job.status in ('queued','retry_waiting')
    and current_job.aws_batch_job_id is null
    and current_job.queue_expires_at > clock_timestamp() then
    return query select false,'queue_waiting'::text,current_job.status;
    return;
  end if;

  -- A project may have waited for a route for more than two hours and then be
  -- claimed immediately before cleanup inspects it. Do not finalize while the
  -- outbox dispatcher or Batch submitter can still be between SubmitJob and
  -- the guarded video_jobs patch.
  if current_job.pipeline_version=2 then
    if current_job.ingestion_route_leased_at is not null
      and current_job.ingestion_route_leased_at >= p_heartbeat_before then
      return query select false,'recent_dispatch_lease'::text,current_job.status;
      return;
    end if;

    if exists (
      select 1
      from shorts_mvp.project_job_outbox outbox
      where outbox.job_id=p_job_id
        and outbox.status='dispatched'
        and outbox.dispatched_at >= p_heartbeat_before
    ) then
      return query select false,'recent_outbox_dispatch'::text,current_job.status;
      return;
    end if;

    if exists (
      select 1
      from shorts_mvp.batch_submission_claims claim
      where claim.submission_key=case
          when current_job.project_resume_count=1
            and current_job.status='rendering'
          then 'project:' || p_job_id::text || ':resume:1'
          else 'project:' || p_job_id::text || ':0'
        end
        and (
          (
            claim.aws_batch_job_id is null
            and claim.claimed_at >= p_heartbeat_before
          )
          or (
            current_job.aws_batch_job_id is null
            and claim.aws_batch_job_id is not null
          )
        )
    ) then
      return query select false,'batch_submission_recorded'::text,current_job.status;
      return;
    end if;
  end if;

  if current_job.execution_backend='mac_pull'
    and current_job.status='queued'
    and current_job.claimed_at is null then
    return query select false,'unclaimed_mac_pull'::text,current_job.status;
    return;
  end if;

  if current_job.pipeline_version=2 then
    select finalized_job.final_status
    into resulting_status
    from shorts_mvp.finalize_project_job(
      p_job_id,stale_error_code,stale_internal_message
    ) finalized_job
    limit 1;
  else
    update shorts_mvp.video_jobs
    set status='failed',stage='failed',progress=100,
        error_code=stale_error_code,error_message=stale_internal_message,
        source_deleted_at=coalesce(source_deleted_at,clock_timestamp()),
        heartbeat_at=clock_timestamp()
    where id=p_job_id;

    update shorts_mvp.usage_reservations
    set status='released',released_at=clock_timestamp()
    where job_id=p_job_id and status='reserved';

    resulting_status := 'failed';
  end if;

  return query select true,'finalized'::text,resulting_status;
end;
$$;

-- This snapshot deliberately excludes mac-pull, upload-service, and normal
-- project rows that are still waiting for an ingestion route. It reports only
-- outbox rows that were already claimed for dispatch, or rows whose dispatch
-- attempt failed, and then remained without a Batch id for five minutes.
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
set search_path = shorts_mvp, pg_temp
as $$
  with actionable as (
    select coalesce(outbox.dispatched_at,outbox.available_at,outbox.created_at)
      as actionable_at
    from shorts_mvp.video_jobs job
    join shorts_mvp.project_job_outbox outbox on outbox.job_id=job.id
    where job.execution_backend='aws_batch'
      and job.pipeline_version=2
      and job.status='queued'
      and job.aws_batch_job_id is null
      and job.queue_expires_at > statement_timestamp()
      and (outbox.status='dispatched' or outbox.last_error is not null)
      and coalesce(outbox.dispatched_at,outbox.available_at,outbox.created_at)
        <= statement_timestamp() - interval '5 minutes'
  ), claim_mismatch as (
    select coalesce(claim.completed_at,claim.updated_at,claim.claimed_at)
      as actionable_at
    from shorts_mvp.video_jobs job
    join shorts_mvp.batch_submission_claims claim
      on claim.submission_key=case
        when job.project_resume_count=1 and job.status='rendering'
          then 'project:' || job.id::text || ':resume:1'
        else 'project:' || job.id::text || ':0'
      end
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
      and coalesce(claim.completed_at,claim.updated_at,claim.claimed_at)
        <= statement_timestamp() - interval '5 minutes'
  )
  select count(*)::bigint,
         min(actionable_at),
         case when min(actionable_at) is null then null::bigint
              else greatest(
                0,
                floor(
                  extract(epoch from statement_timestamp()-min(actionable_at))
                )::bigint
              )
         end,
         (select count(*)::bigint from claim_mismatch),
         (select min(actionable_at) from claim_mismatch),
         case
           when (select min(actionable_at) from claim_mismatch) is null
             then null::bigint
           else greatest(
             0,
             floor(extract(epoch from statement_timestamp()-(
               select min(actionable_at) from claim_mismatch
             )))::bigint
           )
         end
  from actionable;
$$;

revoke all on function shorts_mvp.finalize_stale_video_job_if_unchanged(
  uuid,text,text,timestamptz,timestamptz,timestamptz
) from public,anon,authenticated;
grant execute on function shorts_mvp.finalize_stale_video_job_if_unchanged(
  uuid,text,text,timestamptz,timestamptz,timestamptz
) to service_role;

revoke all on function shorts_mvp.get_batch_dispatch_health()
  from public,anon,authenticated;
grant execute on function shorts_mvp.get_batch_dispatch_health()
  to service_role;

revoke all on function shorts_mvp.claim_batch_submission_target(
  text,text,text,text
) from public,anon,authenticated;
grant execute on function shorts_mvp.claim_batch_submission_target(
  text,text,text,text
) to service_role;

revoke all on function shorts_mvp.complete_batch_submission_target(
  text,text,text,text
) from public,anon,authenticated;
grant execute on function shorts_mvp.complete_batch_submission_target(
  text,text,text,text
) to service_role;

revoke all on function shorts_mvp.complete_project_batch_submission_target(
  text,uuid,text,text,text,text,text,text,text
) from public,anon,authenticated;
grant execute on function shorts_mvp.complete_project_batch_submission_target(
  text,uuid,text,text,text,text,text,text,text
) to service_role;

commit;
