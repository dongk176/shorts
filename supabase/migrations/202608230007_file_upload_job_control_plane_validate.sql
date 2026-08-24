begin;

set local lock_timeout = '3s';
set local statement_timeout = '10min';

alter table shorts_mvp.video_jobs
  validate constraint video_jobs_execution_backend_check,
  validate constraint video_jobs_source_identity_v2_check,
  validate constraint video_jobs_upload_thumbnail_v2_check;

alter table shorts_mvp.upload_sessions
  validate constraint upload_sessions_job_id_fkey,
  validate constraint upload_sessions_declared_content_type_v2_check,
  validate constraint upload_sessions_upload_url_v2_check,
  validate constraint upload_sessions_expires_v2_check,
  validate constraint upload_sessions_job_required_v2_check,
  validate constraint upload_sessions_token_required_v2_check,
  validate constraint upload_sessions_url_required_v2_check;

-- Validated checks let PostgreSQL promote these columns without another table
-- scan while preserving the explicit checks for migration auditability.
alter table shorts_mvp.upload_sessions
  alter column job_id set not null,
  alter column token_hash set not null,
  alter column upload_url set not null;

commit;
