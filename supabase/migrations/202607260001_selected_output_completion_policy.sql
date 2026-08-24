begin;

-- Existing jobs are pinned to policy 1 before the default changes. Jobs inserted
-- after this transaction commits receive policy 2, so an in-flight project never
-- changes completion semantics midway through its run.
alter table shorts_mvp.video_jobs
  add column if not exists completion_policy_version smallint default 1,
  add column if not exists selected_short_count integer not null default 0,
  add column if not exists unselected_short_count integer not null default 0;

update shorts_mvp.video_jobs
set completion_policy_version=1
where completion_policy_version is null;

alter table shorts_mvp.video_jobs
  alter column completion_policy_version set not null,
  alter column completion_policy_version set default 2;

alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_completion_policy_version_check,
  drop constraint if exists video_jobs_selected_short_count_check,
  drop constraint if exists video_jobs_unselected_short_count_check;
alter table shorts_mvp.video_jobs
  add constraint video_jobs_completion_policy_version_check
    check (completion_policy_version in (1,2)),
  add constraint video_jobs_selected_short_count_check
    check (selected_short_count between 0 and 15),
  add constraint video_jobs_unselected_short_count_check
    check (unselected_short_count between 0 and 15);

comment on column shorts_mvp.video_jobs.completion_policy_version is
  '1 uses planned outputs as the completion denominator; 2 snapshots AI-selected outputs.';
comment on column shorts_mvp.video_jobs.selected_short_count is
  'AI-selected output attempts, including later extraction or rendering failures.';
comment on column shorts_mvp.video_jobs.unselected_short_count is
  'Planned output slots that AI did not select.';

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
  counted_selected integer;
  counted_unselected integer;
  counted_ready integer;
  counted_failed integer;
  completion_denominator integer;
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
  into counted_selected
  from shorts_mvp.project_output_attempts
  where job_id=p_job_id and selected_at is not null;

  select least(count(*)::integer,current_job.planned_short_count)
  into counted_ready
  from shorts_mvp.generated_shorts
  where job_id=p_job_id and status='ready' and deleted_at is null;

  -- A ready output is always selected even if legacy metadata was incomplete.
  counted_selected := greatest(counted_selected,counted_ready);
  counted_unselected := greatest(
    0,current_job.planned_short_count-counted_selected
  );
  completion_denominator := case
    when current_job.completion_policy_version >= 2 then counted_selected
    else current_job.planned_short_count
  end;
  counted_failed := greatest(0,completion_denominator-counted_ready);
  counted_percent := case
    when completion_denominator > 0
      then round(100.0 * counted_ready / completion_denominator,2)
    else 0
  end;
  next_status := case
    when completion_denominator > 0
      and counted_ready * 2 >= completion_denominator then 'completed'
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
        selected_short_count=counted_selected,
        unselected_short_count=counted_unselected,
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
      jsonb_build_object(
        'completion_policy_version',current_job.completion_policy_version,
        'planned_count',current_job.planned_short_count,
        'selected_count',counted_selected,
        'unselected_count',counted_unselected,
        'ready_count',counted_ready,
        'failed_count',counted_failed,
        'success_percent',counted_percent
      )
    );
  end if;

  return query select coalesce(
      (select status from shorts_mvp.video_jobs where id=p_job_id),next_status
    ),current_job.planned_short_count,counted_ready,counted_failed,counted_percent,did_transition;
end;
$$;

grant execute on function shorts_mvp.finalize_project_job(uuid,text,text)
  to service_role;

commit;
