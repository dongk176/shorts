alter table shorts_mvp.generated_shorts
  add column if not exists rerender_progress integer not null default 0;

alter table shorts_mvp.generated_shorts
  drop constraint if exists generated_shorts_rerender_progress_check;

alter table shorts_mvp.generated_shorts
  add constraint generated_shorts_rerender_progress_check
  check (rerender_progress between 0 and 100);
