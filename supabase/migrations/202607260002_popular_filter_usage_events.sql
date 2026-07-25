begin;

create table if not exists shorts_mvp.popular_filter_usage_events (
  id uuid primary key default gen_random_uuid(),
  interaction_id uuid not null,
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  subscription_id uuid references shorts_mvp.user_subscriptions(id) on delete set null,
  billing_order_id uuid references shorts_mvp.billing_orders(id) on delete set null,
  filter_type text not null check (filter_type in ('trending','views','reusable')),
  category text not null check (
    category in ('all','entertainment','gaming','sports','music','news','science','howto')
  ),
  reusable_only boolean not null,
  long_form_only boolean not null,
  korean_only boolean not null,
  result_count integer not null check (result_count >= 0),
  occurred_at timestamptz not null default clock_timestamp(),
  unique (user_id,interaction_id)
);

create index if not exists popular_filter_usage_events_order_occurred_idx
  on shorts_mvp.popular_filter_usage_events (billing_order_id,occurred_at desc)
  where billing_order_id is not null;

create index if not exists popular_filter_usage_events_user_occurred_idx
  on shorts_mvp.popular_filter_usage_events (user_id,occurred_at desc);

alter table shorts_mvp.popular_filter_usage_events enable row level security;
revoke all on table shorts_mvp.popular_filter_usage_events from anon, authenticated;
grant all on table shorts_mvp.popular_filter_usage_events to service_role;

comment on table shorts_mvp.popular_filter_usage_events is
  'Server-verified delivery of paid real-time popular filter results for entitlement and refund review.';
comment on column shorts_mvp.popular_filter_usage_events.interaction_id is
  'Client interaction id used only for idempotency; direct API requests receive a server-generated id.';
comment on column shorts_mvp.popular_filter_usage_events.billing_order_id is
  'Consumer-favorable deterministic entitlement source: the active paid period ending first.';

commit;
