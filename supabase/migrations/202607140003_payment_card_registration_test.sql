begin;

create table if not exists shorts_mvp.payment_method_registrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  request_id uuid not null unique,
  order_id text not null unique,
  transaction_id text unique,
  status text not null default 'pending' check (
    status in ('pending', 'active', 'failed', 'unknown', 'revoking', 'revoked', 'revoke_failed')
  ),
  billing_key_ciphertext text,
  billing_key_iv text,
  billing_key_tag text,
  billing_key_hash text,
  card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  card_issuer_code text,
  card_issuer text,
  card_type text,
  card_acquirer_code text,
  card_acquirer text,
  result_code text,
  revocation_order_id text unique,
  revocation_transaction_id text unique,
  revocation_result_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint payment_method_registration_billing_key_complete check (
    (billing_key_ciphertext is null and billing_key_iv is null and billing_key_tag is null and billing_key_hash is null)
    or
    (billing_key_ciphertext is not null and billing_key_iv is not null and billing_key_tag is not null and billing_key_hash is not null)
  )
);

create index if not exists payment_method_registrations_user_created_idx
  on shorts_mvp.payment_method_registrations (user_id, created_at desc);
create index if not exists payment_method_registrations_user_active_idx
  on shorts_mvp.payment_method_registrations (user_id, status)
  where status in ('active', 'revoking', 'revoke_failed');

alter table shorts_mvp.payment_method_registrations enable row level security;
revoke all on shorts_mvp.payment_method_registrations from anon, authenticated;
grant all on shorts_mvp.payment_method_registrations to service_role;

drop trigger if exists payment_method_registrations_set_updated_at
  on shorts_mvp.payment_method_registrations;
create trigger payment_method_registrations_set_updated_at
before update on shorts_mvp.payment_method_registrations
for each row execute function shorts_mvp.set_updated_at();

commit;
