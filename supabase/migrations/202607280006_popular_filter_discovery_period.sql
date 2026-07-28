begin;

alter table shorts_mvp.popular_filter_usage_events
  add column if not exists discovery_period text not null default 'all'
  check (discovery_period in ('today','week','all'));

comment on column shorts_mvp.popular_filter_usage_events.discovery_period is
  'Discovery window applied to the delivered popular-video result.';

commit;
