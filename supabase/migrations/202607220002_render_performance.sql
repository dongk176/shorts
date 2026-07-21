begin;

alter table shorts_mvp.video_jobs
  add column if not exists stage_completed_count integer not null default 0,
  add column if not exists stage_total_count integer not null default 0,
  add column if not exists performance_metrics jsonb not null default '{}'::jsonb;

alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_stage_count_check,
  drop constraint if exists video_jobs_performance_metrics_object_check;
alter table shorts_mvp.video_jobs
  add constraint video_jobs_stage_count_check check (
    stage_completed_count between 0 and 15
    and stage_total_count between 0 and 15
    and stage_completed_count <= stage_total_count
  ),
  add constraint video_jobs_performance_metrics_object_check check (
    jsonb_typeof(performance_metrics) = 'object'
  );

alter table shorts_mvp.project_output_attempts
  add column if not exists performance_metrics jsonb not null default '{}'::jsonb;

alter table shorts_mvp.project_output_attempts
  drop constraint if exists project_output_attempts_performance_metrics_object_check;
alter table shorts_mvp.project_output_attempts
  add constraint project_output_attempts_performance_metrics_object_check check (
    jsonb_typeof(performance_metrics) = 'object'
  );

create or replace function shorts_mvp.apply_job_state_event_v2(
  p_job_id uuid,
  p_stage text,
  p_progress integer,
  p_message text,
  p_event_at timestamptz,
  p_stage_completed_count integer default null,
  p_stage_total_count integer default null
)
returns boolean
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  bounded_total integer;
  bounded_completed integer;
begin
  bounded_total := least(15,greatest(0,coalesce(p_stage_total_count,0)));
  bounded_completed := least(
    bounded_total,
    greatest(0,coalesce(p_stage_completed_count,0))
  );

  update shorts_mvp.video_jobs
  set status=coalesce(p_stage,status),
      stage=coalesce(p_stage,stage),
      progress=case when p_stage is null then progress
                    else greatest(progress,least(100,greatest(0,p_progress))) end,
      stage_completed_count=case
        when p_stage is null or p_stage_total_count is null then stage_completed_count
        else bounded_completed
      end,
      stage_total_count=case
        when p_stage is null or p_stage_total_count is null then stage_total_count
        else bounded_total
      end,
      heartbeat_at=p_event_at
  where id=p_job_id
    and status not in ('completed','failed','expired','deleted','retry_waiting')
    and (heartbeat_at is null or heartbeat_at <= p_event_at);
  if not found then return false; end if;

  if p_stage is not null then
    insert into shorts_mvp.job_events (job_id,stage,progress,message,metadata)
    values (
      p_job_id,
      p_stage,
      least(100,greatest(0,p_progress)),
      left(p_message,500),
      jsonb_strip_nulls(jsonb_build_object(
        'stageCompletedCount',case
          when p_stage_total_count is null then null else bounded_completed
        end,
        'stageTotalCount',case
          when p_stage_total_count is null then null else bounded_total
        end
      ))
    );
  end if;
  return true;
end;
$$;

grant execute on function shorts_mvp.apply_job_state_event_v2(
  uuid,text,integer,text,timestamptz,integer,integer
) to service_role;

commit;
