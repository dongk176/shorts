begin;

alter table shorts_mvp.video_jobs
  add column if not exists execution_backend text not null default 'aws_batch';
alter table shorts_mvp.video_jobs
  add column if not exists worker_id text;
alter table shorts_mvp.video_jobs
  add column if not exists claimed_at timestamptz;

alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_execution_backend_check;
alter table shorts_mvp.video_jobs
  add constraint video_jobs_execution_backend_check
  check (execution_backend in ('aws_batch', 'mac_pull'));

alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_worker_id_check;
alter table shorts_mvp.video_jobs
  add constraint video_jobs_worker_id_check
  check (worker_id is null or char_length(worker_id) between 1 and 120);

create index if not exists video_jobs_mac_pull_queue_idx
  on shorts_mvp.video_jobs (created_at)
  where execution_backend='mac_pull' and status='queued';

commit;
