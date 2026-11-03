-- Local-only billing fixture. This is not a full copy of production or lab.
create role anon;create role authenticated;create role service_role;
create schema shorts_mvp;
create table shorts_mvp.update_posts(id uuid primary key default gen_random_uuid(),visible boolean default false,published jsonb);
create table shorts_mvp.app_users(id uuid primary key,withdrawn_at timestamptz);
create table shorts_mvp.user_subscriptions(
 id uuid primary key,user_id uuid not null references shorts_mvp.app_users(id),plan_code text not null,
 status text not null,billing_cycle text not null,payment_provider text,payment_method_id uuid,
 current_period_start timestamptz,current_period_end timestamptz,cancel_at_period_end boolean not null default false,next_charge_at timestamptz,
 updated_at timestamptz not null default now(),
 constraint user_subscriptions_payment_provider_check check(payment_provider in ('toss','nicepay','thepayone','paddle','paypal'))
);
create table shorts_mvp.billing_orders(id uuid primary key default gen_random_uuid(),user_id uuid not null,provider text,amount_krw integer,status text,approved_at timestamptz,provider_transaction_id text,checkout_expires_at timestamptz);
create table shorts_mvp.billing_toss_checkout_intents(id uuid primary key default gen_random_uuid(),user_id uuid not null,status text,expires_at timestamptz);
create table shorts_mvp.paddle_checkouts(id uuid primary key default gen_random_uuid(),user_id uuid not null,status text);
create table shorts_mvp.paddle_payments(id uuid primary key default gen_random_uuid(),user_id uuid not null);
create table shorts_mvp.paypal_checkouts(id uuid primary key default gen_random_uuid(),user_id uuid not null,status text,environment text,provider_subscription_id text,created_at timestamptz not null default now());
create table shorts_mvp.usage_grants(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references shorts_mvp.app_users(id),subscription_id uuid references shorts_mvp.user_subscriptions(id),
 kind text not null check(kind in ('base','addon')),product_code text not null,total_seconds integer not null check(total_seconds>0),credited_seconds integer not null,carried_seconds integer not null,
 reserved_seconds integer not null default 0 check(reserved_seconds>=0),consumed_seconds integer not null default 0 check(consumed_seconds>=0),
 valid_from timestamptz not null,expires_at timestamptz not null,status text not null default 'active' check(status in ('active','expired','revoked')),updated_at timestamptz not null default now(),
 check(expires_at>valid_from),check(reserved_seconds+consumed_seconds<=total_seconds),check(credited_seconds+carried_seconds=total_seconds)
);
create unique index usage_grants_subscription_period_idx on shorts_mvp.usage_grants(subscription_id,valid_from,kind) where subscription_id is not null and kind='base';

create unique index user_subscriptions_one_current_monthly_idx on shorts_mvp.user_subscriptions(user_id) where status in ('pending','trialing','active','past_due') and billing_cycle='monthly';
