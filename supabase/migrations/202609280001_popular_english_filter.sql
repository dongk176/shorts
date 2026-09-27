begin;
set local lock_timeout = '3s';
alter table shorts_mvp.popular_filter_usage_events
  add column if not exists english_only boolean not null default false;
comment on column shorts_mvp.popular_filter_usage_events.english_only is
  'English-only filter selected; language determined from YouTube language metadata.';
commit;
