begin;

set local lock_timeout = '3s';
set local statement_timeout = '10min';

alter table shorts_mvp.video_jobs
  validate constraint video_jobs_initial_editor_release_id_fkey,
  validate constraint video_jobs_initial_editor_release_v4_check;

commit;
