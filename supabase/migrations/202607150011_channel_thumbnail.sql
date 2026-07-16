alter table shorts_mvp.youtube_analyses
  add column if not exists channel_thumbnail_url text;

alter table shorts_mvp.video_jobs
  add column if not exists channel_thumbnail_url text;
