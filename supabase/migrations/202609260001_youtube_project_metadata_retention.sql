-- Existing rows must retain their true age until successfully revalidated.
alter table shorts_mvp.video_jobs
  add column if not exists youtube_metadata_verified_at timestamptz,
  add column if not exists youtube_metadata_refresh_after timestamptz;
alter table shorts_mvp.video_jobs alter column youtube_metadata_verified_at set default clock_timestamp();
create index if not exists video_jobs_youtube_metadata_refresh_idx
  on shorts_mvp.video_jobs (youtube_metadata_refresh_after,created_at)
  where source_type = 'youtube';
