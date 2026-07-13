begin;

create table if not exists shorts_mvp.batch_submission_claims (
  submission_key text primary key,
  job_name text not null,
  aws_batch_job_id text,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table shorts_mvp.batch_submission_claims enable row level security;
revoke all on table shorts_mvp.batch_submission_claims from anon, authenticated;
grant all on table shorts_mvp.batch_submission_claims to service_role;

create or replace function shorts_mvp.claim_batch_submission(
  p_submission_key text,
  p_job_name text
)
returns table (action text, aws_batch_job_id text)
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  inserted_count integer;
  current_claim shorts_mvp.batch_submission_claims%rowtype;
begin
  insert into shorts_mvp.batch_submission_claims (submission_key, job_name)
  values (p_submission_key, p_job_name)
  on conflict (submission_key) do nothing;
  get diagnostics inserted_count = row_count;

  select * into current_claim
  from shorts_mvp.batch_submission_claims
  where submission_key=p_submission_key
  for update;

  if current_claim.aws_batch_job_id is not null then
    return query select 'existing'::text, current_claim.aws_batch_job_id;
    return;
  end if;
  if inserted_count = 0
    and current_claim.claimed_at > clock_timestamp() - interval '90 seconds' then
    return query select 'busy'::text, null::text;
    return;
  end if;

  update shorts_mvp.batch_submission_claims
  set job_name=p_job_name, claimed_at=clock_timestamp(), updated_at=clock_timestamp()
  where submission_key=p_submission_key;
  return query select 'claimed'::text, null::text;
end;
$$;

create or replace function shorts_mvp.complete_batch_submission(
  p_submission_key text,
  p_aws_batch_job_id text
)
returns boolean
language sql
security definer
set search_path = shorts_mvp, pg_temp
as $$
  update shorts_mvp.batch_submission_claims
  set aws_batch_job_id=p_aws_batch_job_id,
      completed_at=coalesce(completed_at, clock_timestamp()),
      updated_at=clock_timestamp()
  where submission_key=p_submission_key
    and aws_batch_job_id is null
  returning true;
$$;

create or replace function shorts_mvp.claim_ingestion_gate()
returns table (action text)
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  circuit shorts_mvp.ingestion_circuit%rowtype;
begin
  select * into circuit
  from shorts_mvp.ingestion_circuit
  where singleton
  for update;

  if not found or circuit.reason is null then
    return query select 'open'::text;
    return;
  end if;
  if circuit.blocked_until is not null
    and circuit.blocked_until > clock_timestamp() then
    return query select 'wait'::text;
    return;
  end if;

  update shorts_mvp.ingestion_circuit
  set blocked_until=clock_timestamp() + interval '60 seconds',
      reason='probe_in_progress', updated_at=clock_timestamp()
  where singleton;
  return query select 'probe'::text;
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
    return query select 'ignored'::text, coalesce(current_job.attempt_count, 0);
    return;
  end if;

  next_attempt := current_job.attempt_count
    + case when current_job.status='queued' then 1 else 0 end;

  if next_attempt >= 10
    or current_job.deadline_at <= clock_timestamp() + interval '5 minutes' then
    update shorts_mvp.video_jobs
    set status='failed', stage='failed', progress=100,
        attempt_count=next_attempt,
        error_code='batch_failed',
        error_message=(
          '영상을 가져오지 못했습니다. 영상이 공개 상태인지, 로그인·연령·지역 제한이 '
          || '없는지, 삭제되거나 비공개 처리되지 않았는지 확인한 뒤 다시 시도해 주세요.'
        ),
        source_deleted_at=now(), heartbeat_at=now()
    where id=p_job_id;
    update shorts_mvp.usage_reservations
    set status='released', released_at=now()
    where job_id=p_job_id and status='reserved';
    insert into shorts_mvp.job_events (job_id,stage,progress,message,metadata)
    values (
      p_job_id, 'failed', 100,
      '영상을 가져오지 못했습니다. 영상의 공개 및 제한 상태를 확인해 주세요.',
      jsonb_build_object('internal_error', left(p_reason, 300))
    );
    return query select 'failed'::text, next_attempt;
    return;
  end if;

  update shorts_mvp.video_jobs
  set status='retry_waiting', stage='downloading', progress=10,
      attempt_count=next_attempt,
      next_attempt_at=now() + interval '60 seconds',
      error_code='batch_failed', error_message=null, heartbeat_at=now()
  where id=p_job_id;
  if current_job.status <> 'retry_waiting' then
    insert into shorts_mvp.job_events (job_id,stage,progress,message,metadata)
    values (
      p_job_id, 'retry_waiting', 10, '원본 영상을 다시 준비하고 있습니다.',
      jsonb_build_object('internal_error', left(p_reason, 300))
    );
  end if;
  return query select 'retry'::text, next_attempt;
end;
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
  from shorts_mvp.video_jobs
  where id=p_job_id
    and status not in ('completed','failed','expired','deleted')
    and deadline_at > clock_timestamp()
  for update;
  if expected_count is null then return false; end if;

  select count(*) into ready_count
  from shorts_mvp.generated_shorts
  where job_id=p_job_id and status='ready' and deleted_at is null;

  update shorts_mvp.video_jobs
  set ready_short_count=least(ready_count, planned_short_count),
      progress=case when ready_count >= expected_count then 100
                    else greatest(progress, 60 + floor(35.0 * ready_count / expected_count)::int)
               end,
      heartbeat_at=now()
  where id=p_job_id
    and status not in ('completed','failed','expired','deleted')
    and deadline_at > clock_timestamp();

  if ready_count < expected_count then return false; end if;

  update shorts_mvp.video_jobs
  set status='completed', stage='completed', progress=100,
      ready_short_count=least(ready_count, planned_short_count),
      completed_at=coalesce(completed_at, now()), source_deleted_at=now(),
      heartbeat_at=now(),
      expires_at=(
        select max(expires_at) from shorts_mvp.generated_shorts where job_id=p_job_id
      )
  where id=p_job_id
    and status not in ('completed','failed','expired','deleted')
    and deadline_at > clock_timestamp();
  if not found then return false; end if;

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

  insert into shorts_mvp.job_events (job_id, stage, progress, message)
  values (p_job_id, 'completed', 100, '완료되었습니다.');
  return true;
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
    or current_job.deadline_at > clock_timestamp() then
    return query select false;
    return;
  end if;

  update shorts_mvp.video_jobs
  set status='failed', stage='failed', progress=100,
      error_code='job_deadline',
      error_message=(
        '영상을 가져오지 못했습니다. 영상이 공개 상태인지, 로그인·연령·지역 제한이 '
        || '없는지, 삭제되거나 비공개 처리되지 않았는지 확인한 뒤 다시 시도해 주세요.'
      ),
      source_deleted_at=now(), heartbeat_at=now()
  where id=p_job_id;

  update shorts_mvp.usage_reservations
  set status='released', released_at=now()
  where job_id=p_job_id and status='reserved';

  update shorts_mvp.generated_shorts
  set status='failed', render_progress=0,
      render_error_code='job_deadline',
      render_error_message=(
        '영상을 가져오지 못했습니다. 영상이 공개 상태인지, 로그인·연령·지역 제한이 '
        || '없는지, 삭제되거나 비공개 처리되지 않았는지 확인한 뒤 다시 시도해 주세요.'
      )
  where job_id=p_job_id and status in ('rendering','rerendering','ready')
    and deleted_at is null;

  insert into shorts_mvp.job_events (job_id,stage,progress,message)
  values (p_job_id, 'failed', 100, '작업 제한 시간이 종료되었습니다.');
  return query select true;
end;
$$;

grant execute on function shorts_mvp.handle_prepare_batch_failure(uuid,text,text)
  to service_role;
grant execute on function shorts_mvp.claim_batch_submission(text,text)
  to service_role;
grant execute on function shorts_mvp.complete_batch_submission(text,text)
  to service_role;
grant execute on function shorts_mvp.claim_ingestion_gate()
  to service_role;
grant execute on function shorts_mvp.maybe_complete_video_job(uuid)
  to service_role;
grant execute on function shorts_mvp.fail_video_job_at_deadline(uuid)
  to service_role;

commit;
