begin;

set local lock_timeout = '3s';

-- Upload jobs do not have a YouTube identity. Keep the stable YouTube path
-- strict with a source-aware constraint instead of filling these fields with
-- fake URLs or video IDs.
alter table shorts_mvp.video_jobs
  alter column youtube_url drop not null,
  alter column youtube_video_id drop not null;

alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_execution_backend_check,
  drop constraint if exists video_jobs_source_identity_v2_check,
  drop constraint if exists video_jobs_upload_thumbnail_v2_check;

alter table shorts_mvp.video_jobs
  add constraint video_jobs_execution_backend_check
    check (execution_backend in ('aws_batch','mac_pull','upload_service'))
    not valid,
  add constraint video_jobs_source_identity_v2_check check (
    (
      source_type='youtube'
      and youtube_url is not null
      and youtube_video_id is not null
      and execution_backend in ('aws_batch','mac_pull')
    )
    or (
      source_type='upload'
      and youtube_url is null
      and youtube_video_id is null
      and execution_backend='upload_service'
    )
  ) not valid,
  add constraint video_jobs_upload_thumbnail_v2_check check (
    source_type<>'upload'
    or thumbnail_url=(
      '/api/projects/' || project_number::text || '/source-thumbnail'
    )
  ) not valid;

-- The receiver location contains no bearer credential. It is persisted so an
-- idempotent request can return the exact same URL even if deployment config
-- changes while the fifteen-minute intent is alive.
alter table shorts_mvp.upload_sessions
  add column if not exists upload_url text;

alter table shorts_mvp.upload_sessions
  drop constraint if exists upload_sessions_job_id_fkey,
  drop constraint if exists upload_sessions_declared_content_type_check,
  drop constraint if exists upload_sessions_declared_content_type_v2_check,
  drop constraint if exists upload_sessions_upload_url_v2_check,
  drop constraint if exists upload_sessions_expires_v2_check,
  drop constraint if exists upload_sessions_job_required_v2_check,
  drop constraint if exists upload_sessions_token_required_v2_check,
  drop constraint if exists upload_sessions_url_required_v2_check;

alter table shorts_mvp.upload_sessions
  add constraint upload_sessions_job_id_fkey
    foreign key (job_id) references shorts_mvp.video_jobs(id)
    on delete cascade not valid,
  add constraint upload_sessions_declared_content_type_v2_check
    check (char_length(declared_content_type)<=120) not valid,
  add constraint upload_sessions_upload_url_v2_check
    check (upload_url is null or upload_url ~ '^https://') not valid,
  add constraint upload_sessions_expires_v2_check check (
    expires_at>created_at
    and expires_at<=created_at + interval '15 minutes'
  ) not valid,
  add constraint upload_sessions_job_required_v2_check
    check (job_id is not null) not valid,
  add constraint upload_sessions_token_required_v2_check
    check (token_hash is not null) not valid,
  add constraint upload_sessions_url_required_v2_check
    check (upload_url is not null) not valid;

comment on column shorts_mvp.upload_sessions.upload_url is
  'Credential-free HTTPS receiver URL returned unchanged for idempotent retries.';
comment on constraint video_jobs_source_identity_v2_check
  on shorts_mvp.video_jobs is
  'YouTube jobs retain real YouTube identity; upload jobs use the isolated upload service without placeholder YouTube data.';

commit;
