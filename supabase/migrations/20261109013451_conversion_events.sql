begin;
set local lock_timeout = '3s';
create table shorts_mvp.conversion_events (
  id uuid primary key,
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  event_name text not null check (event_name in ('pricing_viewed','upgrade_clicked','checkout_clicked','checkout_opened','checkout_closed','checkout_error','download_requested')),
  locale text not null check (locale in ('ko','en','ja')),
  surface text not null check (surface in ('pricing','header','credit_notice','creation','billing','short_download','project_download')),
  provider text check (provider in ('paddle','toss','paypal','domestic')),
  stage text check (stage in ('api','sdk','provider','script')),
  country text check (country ~ '^[A-Z]{2}$'),
  environment text not null check (environment in ('production','preview','development')),
  deployment_id text check (length(deployment_id) <= 100),
  received_at timestamptz not null default now()
);
create index conversion_events_user_time_idx on shorts_mvp.conversion_events(user_id,received_at);
create index conversion_events_environment_time_idx on shorts_mvp.conversion_events(environment,received_at);
alter table shorts_mvp.conversion_events enable row level security;
revoke all on shorts_mvp.conversion_events from public, anon, authenticated;
grant select, insert, delete on shorts_mvp.conversion_events to service_role;
comment on table shorts_mvp.conversion_events is 'Authenticated conversion funnel. No URLs, titles, IPs or payment payloads. Download requests are not completed transfers. Client events are observational, not payment evidence.';
commit;
