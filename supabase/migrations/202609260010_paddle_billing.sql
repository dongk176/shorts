begin;
set local lock_timeout = '3s';
-- Additive, provider-isolated storage. Never store foreign minor units as KRW.
-- Retain each existing constraint's validation state. Production has legacy
-- NOT VALID boundaries; widening them must not scan/reject unrelated old rows.
do $$ declare target record; expression text; was_validated boolean; begin
 for target in select * from (values
  ('plans','plans_code_check', 'code in (''paddle_lite'',''paddle_creator'',''paddle_pro'')'),
  ('user_subscriptions','user_subscriptions_payment_provider_check', 'payment_provider = ''paddle''')
 ) as boundaries(table_name,constraint_name,addition) loop
  select pg_get_expr(conbin,conrelid),convalidated into expression,was_validated
   from pg_constraint where conrelid=format('shorts_mvp.%I',target.table_name)::regclass
   and conname=target.constraint_name;
  if expression is null then raise exception 'Missing boundary %',target.constraint_name; end if;
  if position('paddle' in expression)=0 then
   execute format('alter table shorts_mvp.%I drop constraint %I',target.table_name,target.constraint_name);
   execute format('alter table shorts_mvp.%I add constraint %I check ((%s) or %s)%s',
    target.table_name,target.constraint_name,expression,target.addition,
    case when was_validated then '' else ' not valid' end);
  end if;
 end loop;
end $$;
insert into shorts_mvp.plans(code,display_name,monthly_source_seconds,retention_days,sort_order,monthly_price_krw,yearly_price_krw,max_active_jobs,is_active,prepaid_months)
values ('paddle_lite','EasyCut Lite',3600,30,901,0,0,1,false,1),
 ('paddle_creator','EasyCut Creator',12000,30,902,0,0,2,false,1),
 ('paddle_pro','EasyCut Pro',36000,30,903,0,0,3,false,1)
on conflict (code) do nothing;
create table if not exists shorts_mvp.paddle_checkouts(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references shorts_mvp.app_users(id),
 environment text not null check(environment in ('sandbox','live')), plan_code text not null references shorts_mvp.plans(code),
 currency text not null check(currency in ('USD','JPY')), price_id text not null,
 transaction_id text unique, status text not null default 'creating' check(status in ('creating','ready','completed','canceled','unknown')),
 created_at timestamptz not null default now()
);
create index if not exists paddle_checkout_user_idx on shorts_mvp.paddle_checkouts(user_id,created_at desc);
create table if not exists shorts_mvp.paddle_subscriptions(
 paddle_id text primary key, user_id uuid not null references shorts_mvp.app_users(id),
 subscription_id uuid not null unique references shorts_mvp.user_subscriptions(id),
 customer_id text not null, environment text not null check(environment in ('sandbox','live')),
 provider_status text not null, provider_updated_at timestamptz not null,
 created_at timestamptz not null default now()
);
create table if not exists shorts_mvp.paddle_payments(
 transaction_id text primary key, user_id uuid not null references shorts_mvp.app_users(id),
 paddle_subscription_id text not null references shorts_mvp.paddle_subscriptions(paddle_id),
 currency text not null check(currency in ('USD','JPY')), amount_minor bigint not null check(amount_minor>0),
 principal_minor bigint not null check(principal_minor>0 and principal_minor<=amount_minor),
 grant_id uuid unique references shorts_mvp.usage_grants(id),
 period_start timestamptz not null, period_end timestamptz not null,
 created_at timestamptz not null default now(), check(period_end>period_start)
);
create table if not exists shorts_mvp.paddle_adjustments(
 id text primary key, transaction_id text not null, amount_minor bigint not null check(amount_minor>=0),
 principal_minor bigint not null check(principal_minor>=0 and principal_minor<=amount_minor),
 status text not null, action text not null, provider_updated_at timestamptz not null
);
create index if not exists paddle_adjustments_transaction_idx on shorts_mvp.paddle_adjustments(transaction_id);
create table if not exists shorts_mvp.paddle_webhook_events(
 event_id text primary key, event_type text not null, occurred_at timestamptz not null,
 processed_at timestamptz not null default now()
);
do $$ declare t text; begin
 foreach t in array array['paddle_checkouts','paddle_subscriptions','paddle_payments','paddle_adjustments','paddle_webhook_events'] loop
 execute format('alter table shorts_mvp.%I enable row level security',t);
 execute format('revoke all on shorts_mvp.%I from public, anon, authenticated',t);
 execute format('grant all on shorts_mvp.%I to service_role',t);
 end loop;
end $$;
-- Reserve the customer before a domestic payment can be charged. A matching check
-- in Paddle checkout creation sees domestic reservations under the same lock.
create or replace function shorts_mvp.guard_domestic_payment_against_paddle()
returns trigger language plpgsql set search_path=pg_catalog,shorts_mvp as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
 if exists(select 1 from shorts_mvp.paddle_checkouts where user_id=new.user_id and status in ('creating','ready','unknown'))
 or exists(select 1 from shorts_mvp.user_subscriptions where user_id=new.user_id and payment_provider='paddle' and status in ('pending','trialing','active','past_due')) then
  raise exception 'Paddle subscription or checkout must be resolved first' using errcode='P0001';
 end if;
 return new;
end $$;
drop trigger if exists prevent_domestic_paddle_overlap on shorts_mvp.billing_orders;
create trigger prevent_domestic_paddle_overlap before insert on shorts_mvp.billing_orders
for each row execute function shorts_mvp.guard_domestic_payment_against_paddle();
drop trigger if exists prevent_toss_paddle_overlap on shorts_mvp.billing_toss_checkout_intents;
create trigger prevent_toss_paddle_overlap before insert on shorts_mvp.billing_toss_checkout_intents
for each row execute function shorts_mvp.guard_domestic_payment_against_paddle();
create or replace function shorts_mvp.guard_withdrawal_against_paddle()
returns trigger language plpgsql set search_path=pg_catalog,shorts_mvp as $$
begin
 if old.withdrawn_at is null and new.withdrawn_at is not null then
  perform pg_advisory_xact_lock(hashtextextended(new.id::text,0));
  if exists(select 1 from shorts_mvp.paddle_checkouts where user_id=new.id and status in ('creating','ready','unknown'))
   or exists(select 1 from shorts_mvp.paddle_subscriptions where user_id=new.id and provider_status<>'canceled') then
   raise exception 'Cancel Paddle checkout/subscription before account withdrawal' using errcode='P0001';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists prevent_paddle_orphan_on_withdrawal on shorts_mvp.app_users;
create trigger prevent_paddle_orphan_on_withdrawal before update of withdrawn_at on shorts_mvp.app_users
for each row execute function shorts_mvp.guard_withdrawal_against_paddle();
commit;
