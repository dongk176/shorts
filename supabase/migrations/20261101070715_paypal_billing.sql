begin;
set local lock_timeout='3s';
do $$ declare expression text; validated boolean; begin
 select pg_get_expr(conbin,conrelid),convalidated into expression,validated from pg_constraint where conrelid='shorts_mvp.user_subscriptions'::regclass and conname='user_subscriptions_payment_provider_check';
 if expression is null then raise exception 'Missing payment provider boundary'; end if;
 if position('paypal' in expression)=0 then
 alter table shorts_mvp.user_subscriptions drop constraint user_subscriptions_payment_provider_check;
 execute format('alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_payment_provider_check check ((%s) or payment_provider=''paypal'')%s',expression,case when validated then '' else ' not valid' end);
 end if;
end $$;
create table if not exists shorts_mvp.paypal_checkouts(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references shorts_mvp.app_users(id),
 environment text not null check(environment in ('live','sandbox')),plan_code text not null,
 provider_plan_id text not null,provider_subscription_id text unique,locale text not null check(locale in ('en','ja')),
 status text not null default 'creating' check(status in ('creating','ready','unknown','completed','canceled')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index if not exists paypal_one_open_checkout on shorts_mvp.paypal_checkouts(user_id,environment) where status in ('creating','ready','unknown');
create index if not exists paypal_checkout_user_idx on shorts_mvp.paypal_checkouts(user_id,created_at desc);
create table if not exists shorts_mvp.paypal_subscriptions(
 paypal_id text primary key,user_id uuid not null references shorts_mvp.app_users(id),checkout_id uuid not null unique references shorts_mvp.paypal_checkouts(id),
 subscription_id uuid unique references shorts_mvp.user_subscriptions(id),environment text not null check(environment in ('live','sandbox')),
 provider_status text not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),last_checked_at timestamptz
);
create index if not exists paypal_subscription_user_idx on shorts_mvp.paypal_subscriptions(user_id,created_at desc);
create table if not exists shorts_mvp.paypal_payments(
 transaction_id text primary key,user_id uuid not null references shorts_mvp.app_users(id),paypal_subscription_id text not null references shorts_mvp.paypal_subscriptions(paypal_id),
 currency text not null check(currency='USD'),amount_minor integer not null check(amount_minor>0),refunded_minor integer not null default 0 check(refunded_minor>=0),
 period_start timestamptz not null,period_end timestamptz not null,plan_code text not null,created_at timestamptz not null default now(),check(period_end>period_start)
);
create table if not exists shorts_mvp.paypal_payment_grants(transaction_id text not null references shorts_mvp.paypal_payments(transaction_id),grant_id uuid not null unique references shorts_mvp.usage_grants(id),original_seconds integer not null check(original_seconds>0),primary key(transaction_id,grant_id));
create table if not exists shorts_mvp.paypal_refunds(refund_id text primary key,transaction_id text not null references shorts_mvp.paypal_payments(transaction_id),amount_minor integer not null check(amount_minor>0),created_at timestamptz not null default now());
create table if not exists shorts_mvp.paypal_webhook_events(event_id text primary key,event_type text not null,processed_at timestamptz not null default now());
do $$ declare t text; begin foreach t in array array['paypal_checkouts','paypal_subscriptions','paypal_payments','paypal_payment_grants','paypal_refunds','paypal_webhook_events'] loop
 execute format('alter table shorts_mvp.%I enable row level security',t);
 execute format('revoke all on shorts_mvp.%I from public,anon,authenticated',t);
 execute format('grant all on shorts_mvp.%I to service_role',t);
 end loop; end $$;
create or replace function shorts_mvp.guard_domestic_payment_against_paypal() returns trigger language plpgsql set search_path=pg_catalog,shorts_mvp as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
 if exists(select 1 from shorts_mvp.paypal_checkouts where user_id=new.user_id and status in ('creating','ready','unknown'))
 or exists(select 1 from shorts_mvp.paypal_subscriptions where user_id=new.user_id and provider_status not in ('CANCELLED','EXPIRED'))
 or exists(select 1 from shorts_mvp.user_subscriptions where user_id=new.user_id and payment_provider='paypal' and current_period_end>now()) then
 raise exception 'Resolve PayPal subscription or checkout first' using errcode='P0001'; end if;
 return new;
end $$;
drop trigger if exists prevent_domestic_paypal_overlap on shorts_mvp.billing_orders;
create trigger prevent_domestic_paypal_overlap before insert on shorts_mvp.billing_orders for each row execute function shorts_mvp.guard_domestic_payment_against_paypal();
drop trigger if exists prevent_toss_paypal_overlap on shorts_mvp.billing_toss_checkout_intents;
create trigger prevent_toss_paypal_overlap before insert on shorts_mvp.billing_toss_checkout_intents for each row execute function shorts_mvp.guard_domestic_payment_against_paypal();
create or replace function shorts_mvp.guard_withdrawal_against_paypal() returns trigger language plpgsql set search_path=pg_catalog,shorts_mvp as $$ begin
 if old.withdrawn_at is null and new.withdrawn_at is not null then
 perform pg_advisory_xact_lock(hashtextextended(new.id::text,0));
 if exists(select 1 from shorts_mvp.paypal_checkouts where user_id=new.id and status in ('creating','ready','unknown')) or exists(select 1 from shorts_mvp.paypal_subscriptions where user_id=new.id and provider_status not in ('CANCELLED','EXPIRED')) then raise exception 'Cancel PayPal before withdrawal'; end if;
 end if; return new; end $$;
drop trigger if exists prevent_paypal_orphan_on_withdrawal on shorts_mvp.app_users;
create trigger prevent_paypal_orphan_on_withdrawal before update of withdrawn_at on shorts_mvp.app_users for each row execute function shorts_mvp.guard_withdrawal_against_paypal();
commit;
