alter table shorts_mvp.video_jobs
  add column if not exists video_aspect_ratio text not null default '1:1';

alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_video_aspect_ratio_check;

alter table shorts_mvp.video_jobs
  add constraint video_jobs_video_aspect_ratio_check
  check (video_aspect_ratio in ('16:9', '5:4', '1:1', '4:5', '9:16'));

alter table shorts_mvp.generated_shorts
  add column if not exists video_aspect_ratio text not null default '1:1';

alter table shorts_mvp.generated_shorts
  drop constraint if exists generated_shorts_video_aspect_ratio_check;

alter table shorts_mvp.generated_shorts
  add constraint generated_shorts_video_aspect_ratio_check
  check (video_aspect_ratio in ('16:9', '5:4', '1:1', '4:5', '9:16'));
