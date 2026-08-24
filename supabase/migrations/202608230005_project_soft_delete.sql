begin;

set local lock_timeout = '3s';

alter table shorts_mvp.video_jobs
  add column if not exists user_deleted_at timestamptz;

comment on column shorts_mvp.video_jobs.user_deleted_at is
  'Time the owner hid the project from their UI. Job status, generated shorts, usage, analytics, and artifacts remain unchanged.';

commit;
