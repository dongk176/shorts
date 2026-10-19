-- Preserve deadline policy, completion accounting, permissions and idempotency.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

create or replace function shorts_mvp.fail_video_job_at_deadline(p_job_id uuid)
returns table (failed boolean)
language plpgsql
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  current_job shorts_mvp.video_jobs%rowtype;
  v_failure_code text;
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

  v_failure_code:=case
    when current_job.status='retry_waiting'
      and current_job.ingestion_route_wait_started_at is not null
      then 'ingestion_capacity_timeout'
    else 'job_deadline'
  end;
  internal_message:=case when v_failure_code='ingestion_capacity_timeout'
    then '원본 영상 처리 경로를 한 시간 안에 확보하지 못했습니다.'
    else '쇼츠를 만드는 중 작업 제한 시간이 종료되었습니다.'
  end;
  public_message:=case when v_failure_code='ingestion_capacity_timeout'
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
        failure_code=v_failure_code,
        failure_message=internal_message,
        failed_at=coalesce(failed_at,clock_timestamp())
    where job_id=p_job_id and status not in ('ready','failed');
    perform shorts_mvp.finalize_project_job(
      p_job_id,v_failure_code,internal_message
    );
    update shorts_mvp.video_jobs
    set error_message=public_message
    where id=p_job_id and status='failed';
  else
    update shorts_mvp.video_jobs
    set status='failed',stage='failed',progress=100,
        error_code=v_failure_code,error_message=public_message,
        source_deleted_at=clock_timestamp(),heartbeat_at=clock_timestamp()
    where id=p_job_id;
    update shorts_mvp.usage_reservations
    set status='released',released_at=clock_timestamp()
    where job_id=p_job_id and status='reserved';
    update shorts_mvp.generated_shorts
    set status='failed',render_progress=0,
        render_error_code=v_failure_code,
        render_error_message=public_message
    where job_id=p_job_id
      and status in ('rendering','rerendering','ready')
      and deleted_at is null;
    insert into shorts_mvp.job_events (job_id,stage,progress,message)
    values (p_job_id,'failed',100,public_message);
  end if;

  update shorts_mvp.project_job_outbox
  set status='failed',last_error=v_failure_code
  where job_id=p_job_id and status<>'failed';
  return query select true;
end;
$$;


COMMIT;
