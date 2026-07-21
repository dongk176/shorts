begin;

alter table shorts_mvp.video_jobs
  add column if not exists pipeline_version smallint not null default 1,
  add column if not exists preparation_finished_at timestamptz,
  add column if not exists project_resume_count integer not null default 0,
  add column if not exists failed_short_count integer not null default 0,
  add column if not exists render_success_percent numeric(5,2);

alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_pipeline_version_check,
  drop constraint if exists video_jobs_project_resume_count_check,
  drop constraint if exists video_jobs_failed_short_count_check,
  drop constraint if exists video_jobs_render_success_percent_check;
alter table shorts_mvp.video_jobs
  add constraint video_jobs_pipeline_version_check check (pipeline_version in (1,2)),
  add constraint video_jobs_project_resume_count_check check (project_resume_count between 0 and 1),
  add constraint video_jobs_failed_short_count_check check (failed_short_count between 0 and 15),
  add constraint video_jobs_render_success_percent_check check (
    render_success_percent is null or render_success_percent between 0 and 100
  );

create table if not exists shorts_mvp.project_output_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references shorts_mvp.video_jobs(id) on delete cascade,
  slot_index integer not null check (slot_index between 1 and 15),
  status text not null default 'pending' check (
    status in ('pending','selected','extracted','rendering','ready','failed')
  ),
  generated_short_id uuid references shorts_mvp.generated_shorts(id) on delete set null,
  failure_stage text check (
    failure_stage is null or failure_stage in (
      'selection','extraction','rendering','project','infrastructure','deadline'
    )
  ),
  failure_code text,
  failure_message text,
  selected_at timestamptz,
  extracted_at timestamptz,
  render_started_at timestamptz,
  ready_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, slot_index),
  unique (generated_short_id)
);

create table if not exists shorts_mvp.project_job_outbox (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references shorts_mvp.video_jobs(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','dispatched','failed')),
  available_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz
);

create index if not exists project_output_attempts_job_status_idx
  on shorts_mvp.project_output_attempts (job_id,status,slot_index);
create index if not exists project_job_outbox_pending_idx
  on shorts_mvp.project_job_outbox (available_at,created_at)
  where status='pending';

drop trigger if exists project_output_attempts_set_updated_at
  on shorts_mvp.project_output_attempts;
create trigger project_output_attempts_set_updated_at
before update on shorts_mvp.project_output_attempts
for each row execute function shorts_mvp.set_updated_at();

alter table shorts_mvp.project_output_attempts enable row level security;
alter table shorts_mvp.project_job_outbox enable row level security;
revoke all on table shorts_mvp.project_output_attempts from anon, authenticated;
revoke all on table shorts_mvp.project_job_outbox from anon, authenticated;
grant all on table shorts_mvp.project_output_attempts to service_role;
grant all on table shorts_mvp.project_job_outbox to service_role;

create or replace function shorts_mvp.initialize_project_output_attempts(p_job_id uuid)
returns integer
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  target_count integer;
begin
  select planned_short_count into target_count
  from shorts_mvp.video_jobs
  where id=p_job_id and pipeline_version=2
  for update;
  if target_count is null then return 0; end if;

  insert into shorts_mvp.project_output_attempts (job_id,slot_index)
  select p_job_id,slot_index
  from generate_series(1,target_count) slot_index
  on conflict (job_id,slot_index) do nothing;
  return target_count;
end;
$$;

create or replace function shorts_mvp.claim_project_job_outbox(p_limit integer default 100)
returns table (
  outbox_id uuid,
  job_id uuid,
  route_id text,
  mvp_session_id uuid,
  user_id uuid
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
  with locked_jobs as materialized (
    select o.id as outbox_id,o.job_id,o.available_at,o.created_at
    from shorts_mvp.project_job_outbox o
    join shorts_mvp.video_jobs j on j.id=o.job_id
    where o.status='pending' and o.available_at <= clock_timestamp()
      and j.pipeline_version=2 and j.status='queued'
      and j.queue_expires_at > clock_timestamp()
    order by o.available_at,o.created_at
    for update of o skip locked
    limit claim_limit
  ), numbered_jobs as materialized (
    select l.*,row_number() over (
      order by l.available_at,l.created_at,l.outbox_id
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
    select j.outbox_id,j.job_id,r.route_id
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
        deadline_at=clock_timestamp() + make_interval(
          mins => 30 + ceil(j.source_duration_seconds / 60.0)::integer
        )
    from leased l
    where j.id=l.leased_job_id and j.pipeline_version=2 and j.status='queued'
    returning j.id,j.mvp_session_id,j.user_id,j.ingestion_route_id
  ), dispatched as materialized (
    update shorts_mvp.project_job_outbox o
    set status='dispatched',dispatched_at=clock_timestamp(),last_error=null
    from assigned j
    where o.job_id=j.id and o.status='pending'
    returning o.id,o.job_id
  )
  select d.id,d.job_id,j.ingestion_route_id,j.mvp_session_id,j.user_id
  from dispatched d join assigned j on j.id=d.job_id;
end;
$$;

create or replace function shorts_mvp.finalize_project_job(
  p_job_id uuid,
  p_error_code text default null,
  p_error_message text default null
)
returns table (
  final_status text,
  planned_count integer,
  ready_count integer,
  failed_count integer,
  success_percent numeric(5,2),
  transitioned boolean
)
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  current_job shorts_mvp.video_jobs%rowtype;
  reservation_row shorts_mvp.usage_reservations%rowtype;
  counted_ready integer;
  counted_failed integer;
  counted_percent numeric(5,2);
  next_status text;
  did_transition boolean := false;
  user_failure_message constant text :=
    '쇼츠가 정상적으로 생성되지 못했습니다. 사용량은 다시 복구되었습니다. 다시 시도해주세요.';
begin
  select * into current_job from shorts_mvp.video_jobs
  where id=p_job_id for update;
  if not found then return; end if;

  select least(count(*)::integer,current_job.planned_short_count)
  into counted_ready
  from shorts_mvp.generated_shorts
  where job_id=p_job_id and status='ready' and deleted_at is null;
  counted_failed := greatest(0,current_job.planned_short_count-counted_ready);
  counted_percent := round(100.0 * counted_ready / current_job.planned_short_count,2);
  next_status := case
    when counted_ready * 2 >= current_job.planned_short_count then 'completed'
    else 'failed'
  end;

  if current_job.status not in ('completed','failed','expired','deleted') then
    if current_job.ingestion_route_id is not null then
      perform shorts_mvp.release_ingestion_route(
        p_job_id,current_job.ingestion_route_id,'terminal',0
      );
    end if;
    update shorts_mvp.project_output_attempts a
    set status='ready',ready_at=coalesce(ready_at,clock_timestamp()),
        failure_stage=null,failure_code=null,failure_message=null,failed_at=null
    where a.job_id=p_job_id and exists (
      select 1 from shorts_mvp.generated_shorts s
      where s.id=a.generated_short_id and s.status='ready' and s.deleted_at is null
    );
    update shorts_mvp.project_output_attempts
    set status='failed',failure_stage=coalesce(failure_stage,'project'),
        failure_code=coalesce(failure_code,left(coalesce(p_error_code,'output_not_ready'),100)),
        failure_message=coalesce(failure_message,left(coalesce(p_error_message,user_failure_message),1000)),
        failed_at=coalesce(failed_at,clock_timestamp())
    where job_id=p_job_id and status <> 'ready';

    update shorts_mvp.generated_shorts
    set status='failed',render_progress=0,
        render_error_code=coalesce(render_error_code,left(coalesce(p_error_code,'output_not_ready'),100)),
        render_error_message=coalesce(render_error_message,left(coalesce(p_error_message,user_failure_message),1000))
    where job_id=p_job_id and status='rendering' and deleted_at is null;

    update shorts_mvp.video_jobs
    set status=next_status,stage=next_status,progress=100,
        ready_short_count=counted_ready,failed_short_count=counted_failed,
        render_success_percent=counted_percent,
        completed_at=case when next_status='completed' then coalesce(completed_at,clock_timestamp()) else completed_at end,
        source_deleted_at=coalesce(source_deleted_at,clock_timestamp()),heartbeat_at=clock_timestamp(),
        expires_at=(select max(expires_at) from shorts_mvp.generated_shorts
                    where job_id=p_job_id and status='ready' and deleted_at is null),
        error_code=case when next_status='failed' then left(coalesce(p_error_code,'insufficient_outputs'),100) else null end,
        error_message=case when next_status='failed' then user_failure_message else null end
    where id=p_job_id;
    did_transition := true;

    if next_status='completed' then
      update shorts_mvp.usage_reservations
      set status='consumed',consumed_at=clock_timestamp()
      where job_id=p_job_id and status='reserved'
      returning * into reservation_row;
      if reservation_row.id is not null then
        insert into shorts_mvp.usage_events
          (mvp_session_id,user_id,job_id,event_type,source_duration_seconds)
        values (reservation_row.mvp_session_id,reservation_row.user_id,p_job_id,
                'source_consumed',reservation_row.source_duration_seconds)
        on conflict (job_id,event_type) do nothing;
      end if;
    else
      update shorts_mvp.usage_reservations
      set status='released',released_at=clock_timestamp()
      where job_id=p_job_id and status='reserved'
      returning * into reservation_row;
      if reservation_row.id is not null then
        insert into shorts_mvp.usage_events
          (mvp_session_id,user_id,job_id,event_type,source_duration_seconds)
        values (reservation_row.mvp_session_id,reservation_row.user_id,p_job_id,
                'reservation_released',reservation_row.source_duration_seconds)
        on conflict (job_id,event_type) do nothing;
      end if;
    end if;

    insert into shorts_mvp.job_events (job_id,stage,progress,message,metadata)
    values (
      p_job_id,next_status,100,
      case when next_status='completed' then '완료되었습니다.' else user_failure_message end,
      jsonb_build_object('planned_count',current_job.planned_short_count,
                         'ready_count',counted_ready,'failed_count',counted_failed,
                         'success_percent',counted_percent)
    );
  end if;

  return query select coalesce(
      (select status from shorts_mvp.video_jobs where id=p_job_id),next_status
    ),current_job.planned_short_count,counted_ready,counted_failed,counted_percent,did_transition;
end;
$$;

create or replace function shorts_mvp.handle_project_batch_failure(
  p_job_id uuid,
  p_batch_job_id text,
  p_reason text
)
returns table (action text, resume_count integer)
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  current_job shorts_mvp.video_jobs%rowtype;
  resumable_count integer;
begin
  select * into current_job from shorts_mvp.video_jobs where id=p_job_id for update;
  if not found or current_job.pipeline_version <> 2
    or current_job.status in ('completed','failed','expired','deleted')
    or current_job.aws_batch_job_id is distinct from p_batch_job_id
  then return query select 'ignored',coalesce(current_job.project_resume_count,0); return; end if;

  if current_job.ingestion_route_id is not null then
    perform shorts_mvp.release_ingestion_route(
      p_job_id,current_job.ingestion_route_id,'batch_failed',0
    );
  end if;

  if current_job.preparation_finished_at is null then
    update shorts_mvp.project_output_attempts
    set status='failed',failure_stage='infrastructure',failure_code='project_batch_failed',
        failure_message=left(p_reason,1000),failed_at=coalesce(failed_at,clock_timestamp())
    where job_id=p_job_id and status not in ('ready','failed');
    perform shorts_mvp.finalize_project_job(p_job_id,'project_batch_failed',p_reason);
    return query select 'finalized',current_job.project_resume_count; return;
  end if;

  update shorts_mvp.project_output_attempts
  set status='failed',failure_stage='infrastructure',failure_code='project_task_interrupted',
      failure_message=left(p_reason,1000),failed_at=coalesce(failed_at,clock_timestamp())
  where job_id=p_job_id and status='rendering';
  update shorts_mvp.generated_shorts s
  set status='failed',render_progress=0,render_error_code='project_task_interrupted',
      render_error_message=left(p_reason,1000)
  where s.job_id=p_job_id and s.status='rendering' and exists (
    select 1 from shorts_mvp.project_output_attempts a
    where a.generated_short_id=s.id and a.status='failed'
      and a.failure_code='project_task_interrupted'
  );

  select count(*)::integer into resumable_count
  from shorts_mvp.project_output_attempts
  where job_id=p_job_id and status='extracted';
  if current_job.project_resume_count=0 and resumable_count > 0 then
    update shorts_mvp.video_jobs
    set project_resume_count=1,status='rendering',stage='rendering',
        aws_batch_job_id=null,error_code=null,error_message=null,heartbeat_at=clock_timestamp()
    where id=p_job_id;
    return query select 'resume',1; return;
  end if;

  update shorts_mvp.project_output_attempts
  set status='failed',failure_stage='infrastructure',failure_code='project_resume_exhausted',
      failure_message=left(p_reason,1000),failed_at=coalesce(failed_at,clock_timestamp())
  where job_id=p_job_id and status not in ('ready','failed');
  perform shorts_mvp.finalize_project_job(p_job_id,'project_resume_exhausted',p_reason);
  return query select 'finalized',current_job.project_resume_count; return;
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
  select * into current_job from shorts_mvp.video_jobs where id=p_job_id for update;
  if not found or current_job.status in ('completed','failed','expired','deleted')
    or (current_job.status in ('queued','retry_waiting') and current_job.queue_expires_at > clock_timestamp())
    or (current_job.status not in ('queued','retry_waiting') and current_job.deadline_at > clock_timestamp())
  then return query select false; return; end if;

  if current_job.ingestion_route_id is not null then
    perform shorts_mvp.release_ingestion_route(p_job_id,current_job.ingestion_route_id,'deadline',0);
  end if;
  if current_job.pipeline_version=2 then
    update shorts_mvp.project_output_attempts
    set status='failed',failure_stage='deadline',failure_code='job_deadline',
        failure_message='쇼츠를 만드는 중 작업 제한 시간이 종료되었습니다.',
        failed_at=coalesce(failed_at,clock_timestamp())
    where job_id=p_job_id and status not in ('ready','failed');
    perform shorts_mvp.finalize_project_job(
      p_job_id,'job_deadline','쇼츠를 만드는 중 작업 제한 시간이 종료되었습니다.'
    );
  else
    update shorts_mvp.video_jobs
    set status='failed',stage='failed',progress=100,error_code='job_deadline',
        error_message='쇼츠를 만드는 중 작업 제한 시간이 종료되었습니다. 다시 시도해 주세요.',
        source_deleted_at=now(),heartbeat_at=now()
    where id=p_job_id;
    update shorts_mvp.usage_reservations set status='released',released_at=now()
    where job_id=p_job_id and status='reserved';
    update shorts_mvp.generated_shorts
    set status='failed',render_progress=0,render_error_code='job_deadline',
        render_error_message='쇼츠를 만드는 중 작업 제한 시간이 종료되었습니다. 다시 시도해 주세요.'
    where job_id=p_job_id and status in ('rendering','rerendering','ready') and deleted_at is null;
    insert into shorts_mvp.job_events (job_id,stage,progress,message)
    values (p_job_id,'failed',100,'작업 제한 시간이 종료되었습니다.');
  end if;
  return query select true;
end;
$$;

grant execute on function shorts_mvp.initialize_project_output_attempts(uuid) to service_role;
grant execute on function shorts_mvp.claim_project_job_outbox(integer) to service_role;
grant execute on function shorts_mvp.finalize_project_job(uuid,text,text) to service_role;
grant execute on function shorts_mvp.handle_project_batch_failure(uuid,text,text) to service_role;
grant execute on function shorts_mvp.fail_video_job_at_deadline(uuid) to service_role;

commit;
