alter table shorts_mvp.generated_shorts
  add column if not exists highlight_reason text not null default '';

alter table shorts_mvp.generated_shorts
  drop constraint if exists generated_shorts_highlight_reason_length_check;

alter table shorts_mvp.generated_shorts
  add constraint generated_shorts_highlight_reason_length_check
  check (char_length(highlight_reason) <= 1000);
