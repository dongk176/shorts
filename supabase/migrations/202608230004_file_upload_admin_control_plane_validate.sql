begin;

set local lock_timeout = '3s';
set local statement_timeout = '10min';

alter table shorts_mvp.video_jobs
  validate constraint video_jobs_source_type_check;

commit;
