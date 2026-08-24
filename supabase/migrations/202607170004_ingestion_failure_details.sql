begin;

alter table shorts_mvp.video_jobs
  add column if not exists error_details jsonb not null default '{}'::jsonb;

alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_error_details_object;
alter table shorts_mvp.video_jobs
  add constraint video_jobs_error_details_object
  check (jsonb_typeof(error_details) = 'object');

comment on column shorts_mvp.video_jobs.error_details is
  'Operator-safe structured failure context. Never store credentials, cookies, tokens, proxy URLs, or full command output.';

commit;
