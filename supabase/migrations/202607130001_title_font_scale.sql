alter table shorts_mvp.generated_shorts
  add column if not exists title_font_scale numeric(3,2) not null default 1.00;

alter table shorts_mvp.generated_shorts
  drop constraint if exists generated_shorts_title_font_scale_check;

alter table shorts_mvp.generated_shorts
  add constraint generated_shorts_title_font_scale_check
  check (title_font_scale between 0.80 and 1.20);
