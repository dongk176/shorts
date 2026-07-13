begin;

alter table shorts_mvp.video_jobs
  alter column deadline_at set default (now() + interval '90 minutes');

-- Keep failed rows visible to the minute cleanup until their S3 artifacts have
-- actually been deleted. Setting deleted_at inside this transaction would make
-- a transient S3 failure permanently skip the row.
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
      error_message='쇼츠를 만드는 중 작업 제한 시간이 종료되었습니다. 다시 시도해 주세요.',
      source_deleted_at=now(), heartbeat_at=now()
  where id=p_job_id;

  update shorts_mvp.usage_reservations
  set status='released', released_at=now()
  where job_id=p_job_id and status='reserved';

  update shorts_mvp.generated_shorts
  set status='failed', render_progress=0,
      render_error_code='job_deadline',
      render_error_message='쇼츠를 만드는 중 작업 제한 시간이 종료되었습니다. 다시 시도해 주세요.'
  where job_id=p_job_id
    and status in ('rendering','rerendering','ready')
    and deleted_at is null;

  insert into shorts_mvp.job_events (job_id,stage,progress,message)
  values (p_job_id, 'failed', 100, '작업 제한 시간이 종료되었습니다.');
  return query select true;
end;
$$;

grant execute on function shorts_mvp.fail_video_job_at_deadline(uuid)
  to service_role;

commit;
