alter table shorts_mvp.video_jobs
  drop constraint if exists video_jobs_template_id_check;
alter table shorts_mvp.video_jobs
  add constraint video_jobs_template_id_check check (
    template_id in ('dark-red', 'white-yellow', 'dark-minimal', 'paper', 'comment-capture')
  );

alter table shorts_mvp.generated_shorts
  add column if not exists comment_overlays jsonb not null default '[]'::jsonb;

alter table shorts_mvp.generated_shorts
  drop constraint if exists generated_shorts_template_id_check;
alter table shorts_mvp.generated_shorts
  add constraint generated_shorts_template_id_check check (
    template_id in ('dark-red', 'white-yellow', 'dark-minimal', 'paper', 'comment-capture')
  );

alter table shorts_mvp.generated_shorts
  drop constraint if exists generated_shorts_comment_overlays_array_check;
alter table shorts_mvp.generated_shorts
  add constraint generated_shorts_comment_overlays_array_check check (
    jsonb_typeof(comment_overlays) = 'array'
    and jsonb_array_length(comment_overlays) <= 20
  );
