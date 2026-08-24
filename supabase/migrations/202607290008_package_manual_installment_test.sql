begin;

alter table shorts_mvp.billing_card_verifications
  add column if not exists provider_credential_scope text,
  add column if not exists provider_merchant_id text,
  add column if not exists provider_terminal_id text;
alter table shorts_mvp.billing_card_verifications
  drop constraint if exists billing_card_verifications_credential_scope_check,
  drop constraint if exists billing_card_verifications_terminal_snapshot_complete;
alter table shorts_mvp.billing_card_verifications
  add constraint billing_card_verifications_credential_scope_check
    check (
      provider_credential_scope is null
      or provider_credential_scope in ('default','package')
    ),
  add constraint billing_card_verifications_terminal_snapshot_complete
    check (
      (
        provider_credential_scope is null
        and provider_merchant_id is null
        and provider_terminal_id is null
      )
      or (
        provider_credential_scope is not null
        and provider_merchant_id is not null
        and provider_terminal_id is not null
      )
    );

alter table shorts_mvp.payment_method_registrations
  add column if not exists provider_credential_scope text not null default 'default',
  add column if not exists provider_merchant_id text,
  add column if not exists provider_terminal_id text;
alter table shorts_mvp.payment_method_registrations
  drop constraint if exists payment_method_registrations_credential_scope_check,
  drop constraint if exists payment_method_registrations_terminal_snapshot_complete;
alter table shorts_mvp.payment_method_registrations
  add constraint payment_method_registrations_credential_scope_check
    check (provider_credential_scope in ('default','package')),
  add constraint payment_method_registrations_terminal_snapshot_complete
    check (
      (provider_merchant_id is null and provider_terminal_id is null)
      or (provider_merchant_id is not null and provider_terminal_id is not null)
    );

alter table shorts_mvp.payment_provider_installment_capabilities
  add column if not exists credential_scope text not null default 'default';
alter table shorts_mvp.payment_provider_installment_capabilities
  drop constraint if exists payment_provider_installment_capabilities_pkey,
  drop constraint if exists payment_provider_installment_capabilities_credential_scope_check;
alter table shorts_mvp.payment_provider_installment_capabilities
  add constraint payment_provider_installment_capabilities_credential_scope_check
    check (credential_scope in ('default','package')),
  add primary key (provider,credential_scope,installment_months);

create table if not exists shorts_mvp.payment_test_package_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  registration_id uuid not null
    references shorts_mvp.payment_method_registrations(id) on delete restrict,
  request_id uuid not null unique,
  scenario text not null check (
    scenario in ('cash_1000','installment_50000_3m')
  ),
  amount integer not null check (amount in (1000,50000)),
  installment_months integer not null check (installment_months in (0,3)),
  order_id text not null unique,
  status text not null default 'pending' check (
    status in ('pending','processing','succeeded','failed','unknown','manual_review')
  ),
  provider_merchant_id text not null,
  provider_terminal_id text not null,
  provider_transaction_id text unique,
  provider_auth_code text,
  provider_result_code text,
  provider_response_amount integer,
  provider_response_installment_months integer,
  provider_card_id_hash text,
  approved_at timestamptz,
  refund_status text not null default 'none' check (
    refund_status in ('none','processing','succeeded','failed','unknown','manual_review')
  ),
  refund_request_id uuid unique,
  refund_track_id text unique,
  refund_transaction_id text unique,
  refund_result_code text,
  refund_response_amount integer,
  refund_response_terminal_id text,
  refunded_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint payment_test_package_orders_scenario_values check (
    (
      scenario='cash_1000'
      and amount=1000
      and installment_months=0
    )
    or (
      scenario='installment_50000_3m'
      and amount=50000
      and installment_months=3
    )
  )
);

create index if not exists payment_test_package_orders_user_created_idx
  on shorts_mvp.payment_test_package_orders (user_id,created_at desc);
create unique index if not exists payment_test_package_orders_one_open_per_user_idx
  on shorts_mvp.payment_test_package_orders (user_id)
  where status in ('pending','processing','unknown','manual_review')
    or refund_status in ('processing','unknown','manual_review');

alter table shorts_mvp.payment_test_package_orders enable row level security;
revoke all on shorts_mvp.payment_test_package_orders from anon, authenticated;
grant all on shorts_mvp.payment_test_package_orders to service_role;

drop trigger if exists payment_test_package_orders_set_updated_at
  on shorts_mvp.payment_test_package_orders;
create trigger payment_test_package_orders_set_updated_at
before update on shorts_mvp.payment_test_package_orders
for each row execute function shorts_mvp.set_updated_at();

commit;
