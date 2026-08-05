begin;

set local lock_timeout = '3s';
set local statement_timeout = '10min';

alter table shorts_mvp.youtube_analyses
  validate constraint youtube_analyses_positive_duration_v2_check;
alter table shorts_mvp.video_jobs
  validate constraint video_jobs_positive_source_duration_v2_check;
alter table shorts_mvp.video_jobs
  validate constraint video_jobs_source_range_selection_v2_check;

commit;
