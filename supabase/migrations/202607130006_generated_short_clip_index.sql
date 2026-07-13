alter table shorts_mvp.generated_shorts
  drop constraint if exists generated_shorts_clip_index_check;

alter table shorts_mvp.generated_shorts
  add constraint generated_shorts_clip_index_check check (
    clip_index between 1 and 15
  );
