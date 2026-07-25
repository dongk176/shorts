begin;

-- Retire provider-specific credentials. Existing Toss billing keys cannot be
-- converted into Nicepay BIDs, so they are invalidated before the columns are
-- made provider-neutral. Historical orders and usage grants are retained.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='billing_payment_methods' and column_name='provider'
  ) then
    update shorts_mvp.user_subscriptions s
    set status='expired', ended_at=coalesce(ended_at,now()), payment_method_id=null,
      next_charge_at=null, next_retry_at=null, next_quota_at=null
    where status in ('pending','trialing','active','past_due')
      and exists (
        select 1 from shorts_mvp.billing_payment_methods m
        where m.id=s.payment_method_id and m.provider='toss'
      );
    delete from shorts_mvp.billing_payment_methods where provider='toss';
  end if;
end $$;

drop index if exists shorts_mvp.app_users_toss_customer_key_idx;
alter table shorts_mvp.app_users drop column if exists toss_customer_key;
alter table shorts_mvp.billing_payment_methods
  drop column if exists customer_key,
  add column if not exists registration_order_id text,
  add column if not exists registration_transaction_id text,
  add column if not exists registration_result_code text;
create unique index if not exists billing_payment_methods_registration_order_idx
  on shorts_mvp.billing_payment_methods (registration_order_id)
  where registration_order_id is not null;
create unique index if not exists billing_payment_methods_registration_transaction_idx
  on shorts_mvp.billing_payment_methods (registration_transaction_id)
  where registration_transaction_id is not null;
alter table shorts_mvp.user_subscriptions drop column if exists provider;
alter table shorts_mvp.billing_orders drop column if exists customer_key;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='billing_orders' and column_name='payment_key'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='billing_orders' and column_name='provider_transaction_id'
  ) then
    alter table shorts_mvp.billing_orders rename column payment_key to provider_transaction_id;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='billing_attempts' and column_name='payment_key'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='billing_attempts' and column_name='provider_transaction_id'
  ) then
    alter table shorts_mvp.billing_attempts rename column payment_key to provider_transaction_id;
  end if;
end $$;

drop table if exists shorts_mvp.billing_webhook_events;

-- Convert the former provider-specific local card test tables in place. The
-- old encrypted tokens are deliberately removed once; subsequent migration
-- replays preserve Nicepay test records.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='payment_method_registrations' and column_name='provider'
  ) then
    delete from shorts_mvp.payment_test_charge_attempts;
    delete from shorts_mvp.payment_test_recurring_runs;
    delete from shorts_mvp.payment_method_registrations;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='payment_method_registrations' and column_name='track_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='payment_method_registrations' and column_name='order_id'
  ) then
    alter table shorts_mvp.payment_method_registrations rename column track_id to order_id;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='payment_method_registrations' and column_name='provider_auth_trx_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='payment_method_registrations' and column_name='transaction_id'
  ) then
    alter table shorts_mvp.payment_method_registrations rename column provider_auth_trx_id to transaction_id;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='payment_method_registrations' and column_name='card_token_ciphertext'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='payment_method_registrations' and column_name='billing_key_ciphertext'
  ) then
    alter table shorts_mvp.payment_method_registrations rename column card_token_ciphertext to billing_key_ciphertext;
    alter table shorts_mvp.payment_method_registrations rename column card_token_iv to billing_key_iv;
    alter table shorts_mvp.payment_method_registrations rename column card_token_tag to billing_key_tag;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='payment_method_registrations' and column_name='provider_result_code'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='payment_method_registrations' and column_name='result_code'
  ) then
    alter table shorts_mvp.payment_method_registrations rename column provider_result_code to result_code;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='payment_method_registrations' and column_name='revocation_track_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='payment_method_registrations' and column_name='revocation_order_id'
  ) then
    alter table shorts_mvp.payment_method_registrations rename column revocation_track_id to revocation_order_id;
    alter table shorts_mvp.payment_method_registrations rename column revocation_trx_id to revocation_transaction_id;
    alter table shorts_mvp.payment_method_registrations rename column revocation_result_code to revocation_result_code_legacy;
  end if;
end $$;

alter table shorts_mvp.payment_method_registrations
  drop constraint if exists payment_method_registrations_provider_check,
  drop constraint if exists payment_method_registrations_billing_day_check,
  drop constraint if exists payment_method_registrations_status_check,
  drop constraint if exists payment_method_registration_token_complete,
  drop constraint if exists payment_method_registration_billing_key_complete,
  drop column if exists provider,
  drop column if exists merchant_id,
  drop column if exists billing_day,
  drop column if exists revocation_result_code_legacy,
  add column if not exists billing_key_hash text,
  add column if not exists card_issuer_code text,
  add column if not exists card_acquirer_code text,
  add column if not exists revocation_result_code text;

alter table shorts_mvp.payment_method_registrations
  add constraint payment_method_registrations_status_check check (
    status in ('pending','active','failed','unknown','revoking','revoked','revoke_failed')
  ),
  add constraint payment_method_registration_billing_key_complete check (
    (billing_key_ciphertext is null and billing_key_iv is null and billing_key_tag is null and billing_key_hash is null)
    or
    (billing_key_ciphertext is not null and billing_key_iv is not null and billing_key_tag is not null and billing_key_hash is not null)
  );
create unique index if not exists payment_method_registrations_billing_key_hash_idx
  on shorts_mvp.payment_method_registrations (billing_key_hash)
  where billing_key_hash is not null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='payment_test_charge_attempts' and column_name='track_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='payment_test_charge_attempts' and column_name='order_id'
  ) then
    alter table shorts_mvp.payment_test_charge_attempts rename column track_id to order_id;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='payment_test_charge_attempts' and column_name='provider_trx_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='payment_test_charge_attempts' and column_name='transaction_id'
  ) then
    alter table shorts_mvp.payment_test_charge_attempts rename column provider_trx_id to transaction_id;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='payment_test_charge_attempts' and column_name='provider_result_code'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='payment_test_charge_attempts' and column_name='result_code'
  ) then
    alter table shorts_mvp.payment_test_charge_attempts rename column provider_result_code to result_code;
  end if;
end $$;

create table if not exists shorts_mvp.payment_test_one_time_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  request_id uuid not null unique,
  order_id text not null unique check (char_length(order_id) between 6 and 64),
  order_name text not null check (char_length(order_name) between 1 and 40),
  amount integer not null check (amount > 0),
  status text not null default 'pending' check (
    status in ('pending','processing','succeeded','failed','unknown','expired')
  ),
  transaction_id text unique,
  auth_result_code text,
  result_code text,
  result_message text,
  card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  card_issuer text,
  card_type text,
  receipt_url text,
  checkout_expires_at timestamptz not null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payment_test_one_time_orders_user_created_idx
  on shorts_mvp.payment_test_one_time_orders (user_id,created_at desc);
create index if not exists payment_test_one_time_orders_pending_expiry_idx
  on shorts_mvp.payment_test_one_time_orders (checkout_expires_at)
  where status='pending';

alter table shorts_mvp.payment_test_one_time_orders enable row level security;
revoke all on shorts_mvp.payment_test_one_time_orders from anon, authenticated;
grant all on shorts_mvp.payment_test_one_time_orders to service_role;
drop trigger if exists payment_test_one_time_orders_set_updated_at
  on shorts_mvp.payment_test_one_time_orders;
create trigger payment_test_one_time_orders_set_updated_at
before update on shorts_mvp.payment_test_one_time_orders
for each row execute function shorts_mvp.set_updated_at();

commit;
