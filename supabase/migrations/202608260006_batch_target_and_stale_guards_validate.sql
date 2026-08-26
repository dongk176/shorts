begin;

set local lock_timeout = '3s';
set local statement_timeout = '10min';

alter table shorts_mvp.video_jobs
  validate constraint video_jobs_batch_target_pair_check,
  validate constraint video_jobs_batch_target_key_check,
  validate constraint video_jobs_batch_target_release_id_check;

alter table shorts_mvp.batch_submission_claims
  validate constraint batch_submission_claims_target_pair_check;

commit;
