alter table shorts_mvp.generated_shorts
  add column if not exists title_text_styles jsonb not null default '[]'::jsonb;

alter table shorts_mvp.generated_shorts
  drop constraint if exists generated_shorts_title_text_styles_array_check;

alter table shorts_mvp.generated_shorts
  add constraint generated_shorts_title_text_styles_array_check
  check (jsonb_typeof(title_text_styles) = 'array');
