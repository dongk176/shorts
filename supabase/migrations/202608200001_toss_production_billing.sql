begin;

-- Toss billing is introduced as an isolated, opt-in provider. This migration is
-- intentionally additive: it does not backfill, update, delete, or reclassify
-- any existing customer, subscription, payment method, order, or usage grant.
set local lock_timeout = '3s';

-- Add the future Toss catalog without exposing it through the current active
-- plan catalog. A later, explicitly approved rollout may activate these rows.
alter table shorts_mvp.plans
  drop constraint if exists plans_code_check_toss_v1;
alter table shorts_mvp.plans
  add constraint plans_code_check_toss_v1
  check (code in (
    'free','plus','standard','pro',
    'easycut_pro_v2',
    'starter_3m','starter_6m','starter_12m',
    'expert_3m','expert_6m','expert_12m',
    'toss_easycut_pro_1m','toss_easycut_pro_6m','toss_easycut_pro_12m',
    'toss_starter_1m','toss_starter_6m','toss_starter_12m',
    'toss_expert_1m','toss_expert_6m','toss_expert_12m'
  )) not valid;
alter table shorts_mvp.plans drop constraint if exists plans_code_check;
alter table shorts_mvp.plans
  rename constraint plans_code_check_toss_v1 to plans_code_check;

insert into shorts_mvp.plans (
  code,display_name,monthly_source_seconds,retention_days,sort_order,
  monthly_price_krw,yearly_price_krw,max_active_jobs,is_active,prepaid_months
) values
  ('toss_easycut_pro_1m','이지컷 프로 1개월',3600,30,140,9900,9900,1,false,1),
  ('toss_easycut_pro_6m','이지컷 프로 6개월',3600,30,141,8900,53400,1,false,6),
  ('toss_easycut_pro_12m','이지컷 프로 12개월',3600,30,142,6900,82800,1,false,12),
  ('toss_starter_1m','스타터 1개월',12000,30,150,24900,24900,2,false,1),
  ('toss_starter_6m','스타터 6개월',12000,30,151,19900,119400,2,false,6),
  ('toss_starter_12m','스타터 12개월',12000,30,152,14900,178800,2,false,12),
  ('toss_expert_1m','전문가 1개월',36000,30,160,59000,59000,3,false,1),
  ('toss_expert_6m','전문가 6개월',36000,30,161,41300,247800,3,false,6),
  ('toss_expert_12m','전문가 12개월',36000,30,162,29500,354000,3,false,12)
on conflict (code) do nothing;

-- The provider constraints are widened without rewriting existing provider
-- values. New Toss rows are only created by feature-gated server routes.
alter table shorts_mvp.billing_payment_methods
  drop constraint if exists billing_payment_methods_provider_check_toss_v1;
alter table shorts_mvp.billing_payment_methods
  add constraint billing_payment_methods_provider_check_toss_v1
  check (provider in ('nicepay','thepayone','toss')) not valid;
alter table shorts_mvp.billing_payment_methods
  drop constraint if exists billing_payment_methods_provider_check;
alter table shorts_mvp.billing_payment_methods
  rename constraint billing_payment_methods_provider_check_toss_v1
  to billing_payment_methods_provider_check;

alter table shorts_mvp.user_subscriptions
  drop constraint if exists user_subscriptions_payment_provider_check_toss_v1;
alter table shorts_mvp.user_subscriptions
  add constraint user_subscriptions_payment_provider_check_toss_v1
  check (payment_provider is null or payment_provider in ('nicepay','thepayone','toss')) not valid;
alter table shorts_mvp.user_subscriptions
  drop constraint if exists user_subscriptions_payment_provider_check;
alter table shorts_mvp.user_subscriptions
  rename constraint user_subscriptions_payment_provider_check_toss_v1
  to user_subscriptions_payment_provider_check;

alter table shorts_mvp.billing_orders
  drop constraint if exists billing_orders_provider_check_toss_v1;
alter table shorts_mvp.billing_orders
  add constraint billing_orders_provider_check_toss_v1
  check (provider in ('nicepay','thepayone','toss')) not valid;
alter table shorts_mvp.billing_orders
  drop constraint if exists billing_orders_provider_check;
alter table shorts_mvp.billing_orders
  rename constraint billing_orders_provider_check_toss_v1
  to billing_orders_provider_check;

-- Toss-specific subscription metadata is nullable and has no defaults, so all
-- existing subscription behavior remains byte-for-byte equivalent.
alter table shorts_mvp.billing_payment_methods
  add column if not exists provider_customer_key text,
  add column if not exists provider_billing_key_issued_at timestamptz,
  add column if not exists provider_billing_key_deleted_at timestamptz;
alter table shorts_mvp.user_subscriptions
  add column if not exists contract_months smallint,
  add column if not exists billing_price_krw integer,
  add column if not exists scheduled_contract_months smallint,
  add column if not exists scheduled_billing_price_krw integer,
  add column if not exists scheduled_change_effective_at timestamptz,
  add column if not exists last_charge_at timestamptz,
  add column if not exists last_charge_failure_code text,
  add column if not exists last_charge_failure_message text;
alter table shorts_mvp.user_subscriptions
  drop constraint if exists user_subscriptions_contract_months_check,
  drop constraint if exists user_subscriptions_billing_price_krw_check,
  drop constraint if exists user_subscriptions_scheduled_contract_months_check,
  drop constraint if exists user_subscriptions_scheduled_billing_price_krw_check;
alter table shorts_mvp.user_subscriptions
  add constraint user_subscriptions_contract_months_check
  check (contract_months is null or contract_months in (1,6,12)) not valid,
  add constraint user_subscriptions_billing_price_krw_check
  check (billing_price_krw is null or billing_price_krw > 0) not valid,
  add constraint user_subscriptions_scheduled_contract_months_check
  check (scheduled_contract_months is null or scheduled_contract_months in (1,6,12)) not valid,
  add constraint user_subscriptions_scheduled_billing_price_krw_check
  check (scheduled_billing_price_krw is null or scheduled_billing_price_krw > 0) not valid;
-- Legacy prepaid packages are intentionally stackable. Toss subscriptions are
-- not: this provider-only partial index prevents accidental double contracts
-- without changing or even scanning the behavior of legacy provider rows.

-- Cohorts are assigned lazily. No production user is classified by migration.
-- Once assigned, the cohort cannot be changed by application code.
create table if not exists shorts_mvp.billing_customer_cohorts (
  user_id uuid primary key references shorts_mvp.app_users(id) on delete cascade,
  cohort text not null check (cohort in ('legacy_thepayone','toss_v1')),
  provider_customer_key text unique,
  source_reason text not null check (char_length(source_reason) between 1 and 120),
  assigned_at timestamptz not null default now(),
  check (
    (cohort='toss_v1' and provider_customer_key is not null)
    or (cohort='legacy_thepayone' and provider_customer_key is null)
  ),
  unique (user_id,cohort)
);

create or replace function shorts_mvp.prevent_billing_cohort_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.cohort is distinct from old.cohort
    or new.provider_customer_key is distinct from old.provider_customer_key then
    raise exception 'billing customer cohort is immutable';
  end if;
  return new;
end
$$;
drop trigger if exists billing_customer_cohorts_immutable
  on shorts_mvp.billing_customer_cohorts;
create trigger billing_customer_cohorts_immutable
before update on shorts_mvp.billing_customer_cohorts
for each row execute function shorts_mvp.prevent_billing_cohort_change();

-- Permanent Toss transaction ledger. Only operational identifiers and a
-- sanitized response summary are stored; card data and secrets are forbidden.
create table if not exists shorts_mvp.billing_toss_transactions (
  id uuid primary key default gen_random_uuid(),
  root_transaction_id uuid references shorts_mvp.billing_toss_transactions(id) on delete restrict,
  user_id uuid not null references shorts_mvp.app_users(id) on delete restrict,
  cohort text not null default 'toss_v1' check (cohort='toss_v1'),
  billing_order_id uuid references shorts_mvp.billing_orders(id) on delete set null,
  subscription_id uuid references shorts_mvp.user_subscriptions(id) on delete set null,
  payment_method_id uuid references shorts_mvp.billing_payment_methods(id) on delete set null,
  transaction_type text not null check (transaction_type in ('payment','cancellation')),
  provider_order_id text not null unique check (char_length(provider_order_id) between 6 and 100),
  payment_key text,
  transaction_key text,
  idempotency_key text unique,
  amount_krw integer not null check (amount_krw >= 0),
  canceled_amount_krw integer not null default 0 check (canceled_amount_krw >= 0),
  status text not null check (status in (
    'requested','processing','succeeded','failed','unknown','canceled','partial_canceled'
  )),
  failure_code text,
  failure_message text,
  attempt_no integer not null default 1 check (attempt_no between 1 and 10),
  next_retry_at timestamptz,
  outcome_reconciled_at timestamptz,
  fulfillment_status text not null default 'not_required' check (
    fulfillment_status in ('not_required','pending','applied','manual_review')
  ),
  fulfillment_failure_message text,
  fulfilled_at timestamptz,
  response_summary jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (canceled_amount_krw <= amount_krw),
  check (
    (transaction_type='payment' and root_transaction_id is null)
    or (transaction_type='cancellation' and root_transaction_id is not null)
  ),
  check (
    status in ('requested','processing','failed','unknown')
    or payment_key is not null
  ),
  foreign key (user_id,cohort)
    references shorts_mvp.billing_customer_cohorts(user_id,cohort)
    on delete restrict
);
create unique index if not exists billing_toss_payment_key_payment_idx
  on shorts_mvp.billing_toss_transactions (payment_key)
  where transaction_type='payment' and payment_key is not null;
create unique index if not exists billing_toss_transaction_key_cancel_idx
  on shorts_mvp.billing_toss_transactions (transaction_key)
  where transaction_type='cancellation' and transaction_key is not null;
create unique index if not exists billing_toss_single_inflight_cancel_idx
  on shorts_mvp.billing_toss_transactions (root_transaction_id)
  where transaction_type='cancellation'
    and status in ('requested','processing','unknown');
create index if not exists billing_toss_transactions_user_created_idx
  on shorts_mvp.billing_toss_transactions (user_id,created_at desc);
create index if not exists billing_toss_transactions_order_idx
  on shorts_mvp.billing_toss_transactions (billing_order_id,created_at);
create index if not exists billing_toss_transactions_reconciliation_idx
  on shorts_mvp.billing_toss_transactions (next_retry_at,created_at)
  where status in ('failed','unknown');

create table if not exists shorts_mvp.billing_toss_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  payment_key text,
  processing_status text not null default 'received' check (
    processing_status in ('received','processed','ignored','failed','manual_review')
  ),
  event_summary jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  failure_message text
);
create index if not exists billing_toss_webhook_events_status_idx
  on shorts_mvp.billing_toss_webhook_events (processing_status,received_at);

-- A short-lived server-owned intent binds the selected plan and customer to a
-- single card-registration callback. Provider redirect query parameters are
-- never trusted as the source of the product or amount.
create table if not exists shorts_mvp.billing_toss_checkout_intents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  user_id uuid not null references shorts_mvp.app_users(id) on delete restrict,
  cohort text not null default 'toss_v1' check (cohort='toss_v1'),
  provider_customer_key text not null,
  target_plan_code text not null check (target_plan_code in (
    'toss_easycut_pro_1m','toss_easycut_pro_6m','toss_easycut_pro_12m',
    'toss_starter_1m','toss_starter_6m','toss_starter_12m',
    'toss_expert_1m','toss_expert_6m','toss_expert_12m'
  )),
  purpose text not null default 'subscription_start' check (
    purpose in ('subscription_start','payment_method_replace')
  ),
  status text not null default 'prepared' check (
    status in (
      'prepared','processing','payment_method_registered','succeeded',
      'failed','expired','manual_review'
    )
  ),
  payment_method_id uuid references shorts_mvp.billing_payment_methods(id) on delete set null,
  subscription_id uuid references shorts_mvp.user_subscriptions(id) on delete set null,
  result_summary jsonb not null default '{}'::jsonb,
  failure_code text,
  failure_message text,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id,cohort)
    references shorts_mvp.billing_customer_cohorts(user_id,cohort)
    on delete restrict,
  check (char_length(provider_customer_key) between 10 and 100)
);
create index if not exists billing_toss_checkout_intents_user_created_idx
  on shorts_mvp.billing_toss_checkout_intents (user_id,created_at desc);
create index if not exists billing_toss_checkout_intents_expiry_idx
  on shorts_mvp.billing_toss_checkout_intents (expires_at)
  where status in ('prepared','processing','payment_method_registered');

alter table shorts_mvp.billing_customer_cohorts enable row level security;
alter table shorts_mvp.billing_toss_transactions enable row level security;
alter table shorts_mvp.billing_toss_webhook_events enable row level security;
alter table shorts_mvp.billing_toss_checkout_intents enable row level security;
revoke all on shorts_mvp.billing_customer_cohorts from anon, authenticated;
revoke all on shorts_mvp.billing_toss_transactions from anon, authenticated;
revoke all on shorts_mvp.billing_toss_webhook_events from anon, authenticated;
revoke all on shorts_mvp.billing_toss_checkout_intents from anon, authenticated;
grant all on shorts_mvp.billing_customer_cohorts to service_role;
grant all on shorts_mvp.billing_toss_transactions to service_role;
grant all on shorts_mvp.billing_toss_webhook_events to service_role;
grant all on shorts_mvp.billing_toss_checkout_intents to service_role;

drop trigger if exists billing_toss_transactions_set_updated_at
  on shorts_mvp.billing_toss_transactions;
create trigger billing_toss_transactions_set_updated_at
before update on shorts_mvp.billing_toss_transactions
for each row execute function shorts_mvp.set_updated_at();

drop trigger if exists billing_toss_checkout_intents_set_updated_at
  on shorts_mvp.billing_toss_checkout_intents;
create trigger billing_toss_checkout_intents_set_updated_at
before update on shorts_mvp.billing_toss_checkout_intents
for each row execute function shorts_mvp.set_updated_at();

commit;
