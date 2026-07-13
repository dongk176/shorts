alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_expected_short_count_check;

alter table shorts_mvp.video_jobs
  add constraint video_jobs_expected_short_count_check check (
    expected_short_count between 1 and 15
  );
