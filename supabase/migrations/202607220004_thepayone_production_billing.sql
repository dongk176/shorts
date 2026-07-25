begin;

-- Preserve historical Nicepay rows while making ThePayOne the default for all
-- newly-created production billing records.
alter table shorts_mvp.billing_payment_methods
  add column if not exists provider text;
update shorts_mvp.billing_payment_methods set provider='nicepay' where provider is null;
alter table shorts_mvp.billing_payment_methods alter column provider set default 'thepayone';
alter table shorts_mvp.billing_payment_methods alter column provider set not null;
alter table shorts_mvp.billing_payment_methods
  drop constraint if exists billing_payment_methods_provider_check;
alter table shorts_mvp.billing_payment_methods
  add constraint billing_payment_methods_provider_check
  check (provider in ('nicepay','thepayone'));

alter table shorts_mvp.billing_payment_methods
  add column if not exists provider_merchant_id text,
  add column if not exists provider_terminal_id text,
  add column if not exists provider_schedule_status text not null default 'none';
alter table shorts_mvp.billing_payment_methods
  drop constraint if exists billing_payment_methods_status_check,
  drop constraint if exists billing_payment_methods_provider_schedule_status_check;
alter table shorts_mvp.billing_payment_methods
  add constraint billing_payment_methods_status_check
  check (status in ('active','scheduled','paused','replaced','revoked','manual_review')),
  add constraint billing_payment_methods_provider_schedule_status_check
  check (provider_schedule_status in ('none','active','paused','disposed','manual_review'));

alter table shorts_mvp.user_subscriptions
  add column if not exists payment_provider text,
  add column if not exists provider_schedule_status text not null default 'none',
  add column if not exists billing_review_status text not null default 'clear',
  add column if not exists billing_review_reason text,
  add column if not exists last_provider_event_at timestamptz;
update shorts_mvp.user_subscriptions
set payment_provider='nicepay'
where payment_provider is null and payment_method_id is not null;
alter table shorts_mvp.user_subscriptions alter column payment_provider set default 'thepayone';
alter table shorts_mvp.user_subscriptions
  drop constraint if exists user_subscriptions_payment_provider_check,
  drop constraint if exists user_subscriptions_provider_schedule_status_check,
  drop constraint if exists user_subscriptions_billing_review_status_check;
alter table shorts_mvp.user_subscriptions
  add constraint user_subscriptions_payment_provider_check
  check (payment_provider is null or payment_provider in ('nicepay','thepayone')),
  add constraint user_subscriptions_provider_schedule_status_check
  check (provider_schedule_status in ('none','active','paused','disposed','manual_review')),
  add constraint user_subscriptions_billing_review_status_check
  check (billing_review_status in ('clear','manual_review'));

alter table shorts_mvp.billing_orders
  add column if not exists provider text,
  add column if not exists provider_track_id text,
  add column if not exists provider_merchant_id text,
  add column if not exists provider_terminal_id text,
  add column if not exists provider_card_id_hash text;
update shorts_mvp.billing_orders set provider='nicepay' where provider is null;
alter table shorts_mvp.billing_orders alter column provider set default 'thepayone';
alter table shorts_mvp.billing_orders alter column provider set not null;
alter table shorts_mvp.billing_orders
  drop constraint if exists billing_orders_provider_check,
  drop constraint if exists billing_orders_kind_check,
  drop constraint if exists billing_orders_status_check;
alter table shorts_mvp.billing_orders
  add constraint billing_orders_provider_check check (provider in ('nicepay','thepayone')),
  add constraint billing_orders_kind_check check (kind in (
    'subscription_initial','subscription_renewal','subscription_change',
    'annual_renewal','addon','payment_method_update'
  )),
  add constraint billing_orders_status_check check (status in (
    'pending','processing','succeeded','failed','unknown','manual_review','canceled','expired'
  ));
create index if not exists billing_orders_provider_track_idx
  on shorts_mvp.billing_orders (provider,provider_track_id)
  where provider_track_id is not null;

create table if not exists shorts_mvp.billing_payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('thepayone')),
  provider_transaction_id text not null,
  billing_order_id uuid references shorts_mvp.billing_orders(id) on delete set null,
  subscription_id uuid references shorts_mvp.user_subscriptions(id) on delete set null,
  payment_method_id uuid references shorts_mvp.billing_payment_methods(id) on delete set null,
  merchant_id text not null,
  terminal_id text not null,
  track_id text not null,
  card_id_hash text,
  transaction_type text not null check (transaction_type in ('pay','refund')),
  amount_krw integer not null check (amount_krw >= 0),
  validation_status text not null default 'received' check (
    validation_status in ('received','validated','processed','manual_review','rejected')
  ),
  processing_result text,
  event_summary jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (provider,provider_transaction_id)
);
create index if not exists billing_payment_events_track_idx
  on shorts_mvp.billing_payment_events (provider,track_id,received_at desc);
create index if not exists billing_payment_events_review_idx
  on shorts_mvp.billing_payment_events (validation_status,received_at)
  where validation_status='manual_review';

alter table shorts_mvp.billing_payment_events enable row level security;
revoke all on shorts_mvp.billing_payment_events from anon, authenticated;
grant all on shorts_mvp.billing_payment_events to service_role;
drop trigger if exists billing_payment_events_set_updated_at
  on shorts_mvp.billing_payment_events;
create trigger billing_payment_events_set_updated_at
before update on shorts_mvp.billing_payment_events
for each row execute function shorts_mvp.set_updated_at();

commit;
