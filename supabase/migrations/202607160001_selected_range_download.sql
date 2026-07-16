alter table shorts_mvp.video_jobs
  add column if not exists range_download_status text not null default 'pending',
  add column if not exists downloaded_media_duration_seconds numeric(10,3),
  add column if not exists downloaded_media_bytes bigint,
  add column if not exists range_download_verified_at timestamptz;

alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_range_download_status_check,
  drop constraint if exists video_jobs_downloaded_media_duration_check,
  drop constraint if exists video_jobs_downloaded_media_bytes_check;

alter table shorts_mvp.video_jobs
  add constraint video_jobs_range_download_status_check check (
    range_download_status in (
      'pending',
      'selected_range',
      'full_source_expected',
      'full_source_unexpected',
      'unexpected_duration'
    )
  ),
  add constraint video_jobs_downloaded_media_duration_check check (
    downloaded_media_duration_seconds is null
    or downloaded_media_duration_seconds > 0
  ),
  add constraint video_jobs_downloaded_media_bytes_check check (
    downloaded_media_bytes is null or downloaded_media_bytes > 0
  );

comment on column shorts_mvp.video_jobs.range_download_status is
  'Whether the saved media matched the requested range or unexpectedly contained the full source';
comment on column shorts_mvp.video_jobs.downloaded_media_duration_seconds is
  'FFprobe duration of the downloaded media file before transcription';
comment on column shorts_mvp.video_jobs.downloaded_media_bytes is
  'Size of the downloaded media file before transcription; not network transfer bytes';
