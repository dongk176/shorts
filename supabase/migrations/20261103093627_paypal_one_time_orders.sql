begin;
set local lock_timeout='3s';
create table shorts_mvp.paypal_one_time_orders (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references shorts_mvp.app_users(id),
 environment text not null check(environment in ('live','sandbox')),
 plan_code text not null, locale text not null check(locale in ('en','ja')),
 status text not null check(status in ('creating','ready','capturing','unknown','completed','canceled','declined')),
 provider_order_id text unique, merchant_id text, approval_url text,
 capture_id text unique, amount_minor integer check(amount_minor>0),
 currency text check(currency='USD'), subscription_id uuid unique references shorts_mvp.user_subscriptions(id),
 paid_at timestamptz, access_end timestamptz,
 refunded_minor integer not null default 0 check(refunded_minor>=0 and (amount_minor is null or refunded_minor<=amount_minor)),
 reversed boolean not null default false,entitlement_hold boolean not null default false,
 consent_at timestamptz not null default now(),terms_snapshot jsonb not null,
 capture_started_at timestamptz,last_checked_at timestamptz,last_error_code text,last_debug_id text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index paypal_one_time_open on shorts_mvp.paypal_one_time_orders(user_id,environment)
 where status in ('creating','ready','capturing','unknown');
create table shorts_mvp.paypal_one_time_grants (
 order_id uuid not null references shorts_mvp.paypal_one_time_orders(id),
 grant_id uuid not null unique references shorts_mvp.usage_grants(id),
 original_seconds integer not null check(original_seconds>0),
 primary key(order_id,grant_id)
);
alter table shorts_mvp.paypal_one_time_orders enable row level security;
create index paypal_one_time_user_created on shorts_mvp.paypal_one_time_orders(user_id,created_at desc);
create index paypal_one_time_reconcile on shorts_mvp.paypal_one_time_orders(environment,last_checked_at,created_at);
create table shorts_mvp.paypal_one_time_refunds (
 refund_id text primary key,order_id uuid not null references shorts_mvp.paypal_one_time_orders(id),
 amount_minor integer not null check(amount_minor>0),created_at timestamptz not null default now()
);
alter table shorts_mvp.paypal_one_time_refunds enable row level security;
revoke all on shorts_mvp.paypal_one_time_refunds from public,anon,authenticated;
grant all on shorts_mvp.paypal_one_time_refunds to service_role;
alter table shorts_mvp.paypal_one_time_grants enable row level security;
revoke all on shorts_mvp.paypal_one_time_orders,shorts_mvp.paypal_one_time_grants from public,anon,authenticated;
grant all on shorts_mvp.paypal_one_time_orders,shorts_mvp.paypal_one_time_grants to service_role;

create function shorts_mvp.guard_against_paypal_one_time() returns trigger
 language plpgsql set search_path=pg_catalog,shorts_mvp as $$ begin
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
 if exists(select 1 from shorts_mvp.paypal_one_time_orders where user_id=new.user_id
  and (status in ('creating','ready','capturing','unknown') or (status='completed' and access_end>now() and refunded_minor<amount_minor and not reversed))) then
  raise exception 'Resolve the one-time checkout first';
 end if;
 return new;
end $$;
create trigger prevent_one_time_domestic_overlap before insert on shorts_mvp.billing_orders
 for each row execute function shorts_mvp.guard_against_paypal_one_time();
create trigger prevent_one_time_toss_overlap before insert on shorts_mvp.billing_toss_checkout_intents
 for each row execute function shorts_mvp.guard_against_paypal_one_time();
create trigger prevent_one_time_recurring_overlap before insert on shorts_mvp.paypal_checkouts
 for each row execute function shorts_mvp.guard_against_paypal_one_time();
create trigger prevent_one_time_paddle_overlap before insert on shorts_mvp.paddle_checkouts
 for each row execute function shorts_mvp.guard_against_paypal_one_time();
create function shorts_mvp.guard_withdrawal_against_paypal_one_time() returns trigger
 language plpgsql set search_path=pg_catalog,shorts_mvp as $$ begin
 if old.withdrawn_at is null and new.withdrawn_at is not null then
  perform pg_advisory_xact_lock(hashtextextended(new.id::text,0));
  if exists(select 1 from shorts_mvp.paypal_one_time_orders where user_id=new.id and status in ('creating','ready','capturing','unknown')) then
   raise exception 'Resolve the one-time checkout before withdrawal';
  end if;
 end if;
 return new;
end $$;
create trigger prevent_one_time_withdrawal before update of withdrawn_at on shorts_mvp.app_users
 for each row execute function shorts_mvp.guard_withdrawal_against_paypal_one_time();
revoke all on function shorts_mvp.guard_against_paypal_one_time(),shorts_mvp.guard_withdrawal_against_paypal_one_time() from public,anon,authenticated;
commit;
