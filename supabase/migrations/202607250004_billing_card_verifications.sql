begin;

create table if not exists shorts_mvp.billing_card_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  request_id uuid not null unique,
  provider text not null default 'thepayone' check (provider='thepayone'),
  mode text not null check (mode in ('subscribe','change_subscription')),
  plan_code text not null references shorts_mvp.plans(code),
  billing_cycle text not null check (billing_cycle in ('monthly','yearly')),
  billing_day text not null check (billing_day ~ '^(00|0[1-9]|1[0-9]|2[0-8])$'),
  status text not null default 'pending' check (
    status in (
      'pending','active','consuming','consumed','failed','unknown',
      'revoking','revoked','expired','revoke_failed'
    )
  ),
  provider_order_id text not null unique,
  provider_transaction_id text unique,
  provider_result_code text,
  billing_key_ciphertext text,
  billing_key_iv text,
  billing_key_tag text,
  billing_key_hash text,
  issuer_name text,
  card_type text,
  acquirer_name text,
  card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  consumed_payment_method_id uuid references shorts_mvp.billing_payment_methods(id) on delete set null,
  consumed_billing_order_id uuid references shorts_mvp.billing_orders(id) on delete set null,
  revocation_order_id text unique,
  revocation_transaction_id text unique,
  revocation_result_code text,
  expires_at timestamptz not null default (clock_timestamp()+interval '15 minutes'),
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_card_verification_key_complete check (
    (
      billing_key_ciphertext is null
      and billing_key_iv is null
      and billing_key_tag is null
      and billing_key_hash is null
    )
    or (
      billing_key_ciphertext is not null
      and billing_key_iv is not null
      and billing_key_tag is not null
      and billing_key_hash is not null
      and length(billing_key_hash)=64
    )
  )
);

create index if not exists billing_card_verifications_user_created_idx
  on shorts_mvp.billing_card_verifications (user_id,created_at desc);
create index if not exists billing_card_verifications_expiry_idx
  on shorts_mvp.billing_card_verifications (expires_at)
  where status in ('active','revoke_failed');
create index if not exists billing_card_verifications_user_status_idx
  on shorts_mvp.billing_card_verifications (user_id,status,expires_at);

alter table shorts_mvp.billing_card_verifications enable row level security;
revoke all on shorts_mvp.billing_card_verifications from anon, authenticated;
grant all on shorts_mvp.billing_card_verifications to service_role;

drop trigger if exists billing_card_verifications_set_updated_at
  on shorts_mvp.billing_card_verifications;
create trigger billing_card_verifications_set_updated_at
before update on shorts_mvp.billing_card_verifications
for each row execute function shorts_mvp.set_updated_at();

commit;
