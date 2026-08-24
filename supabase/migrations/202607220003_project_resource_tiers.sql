begin;

create or replace function shorts_mvp.sync_terminal_project_stage_counts()
returns trigger
language plpgsql
set search_path = shorts_mvp, pg_temp
as $$
begin
  if new.pipeline_version=2
     and new.status in ('completed','failed','expired','deleted')
     and new.stage_completed_count < new.stage_total_count then
    new.stage_completed_count := new.stage_total_count;
  end if;
  return new;
end;
$$;

drop trigger if exists video_jobs_sync_terminal_project_stage_counts
  on shorts_mvp.video_jobs;
create trigger video_jobs_sync_terminal_project_stage_counts
before insert or update on shorts_mvp.video_jobs
for each row execute function shorts_mvp.sync_terminal_project_stage_counts();

update shorts_mvp.video_jobs
set stage_completed_count=stage_total_count
where pipeline_version=2
  and status in ('completed','failed','expired','deleted')
  and stage_completed_count < stage_total_count;

commit;
