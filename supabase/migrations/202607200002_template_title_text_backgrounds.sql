alter table shorts_mvp.generated_shorts
  add column if not exists title_text_styles_initialized boolean not null default false;

update shorts_mvp.generated_shorts
set title_text_styles='[]'::jsonb
where title_text_styles is null;

alter table shorts_mvp.generated_shorts
  alter column title_text_styles set default '[]'::jsonb,
  alter column title_text_styles set not null;
