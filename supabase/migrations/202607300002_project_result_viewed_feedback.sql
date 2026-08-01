begin;

alter table shorts_mvp.video_jobs
  add column if not exists result_viewed_at timestamptz;

create index if not exists video_jobs_feedback_viewed_user_idx
  on shorts_mvp.video_jobs (user_id,result_viewed_at)
  where result_viewed_at is not null and not is_example;

comment on column shorts_mvp.video_jobs.result_viewed_at is
  'First time the owner reached the completed project results after the reveal; gates product feedback eligibility.';

commit;
