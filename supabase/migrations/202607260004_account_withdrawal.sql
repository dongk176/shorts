begin;

alter table shorts_mvp.app_users
  add column if not exists withdrawn_at timestamptz;

create table if not exists shorts_mvp.account_withdrawal_retention (
  user_id uuid primary key references shorts_mvp.app_users(id) on delete cascade,
  withdrawn_at timestamptz not null,
  contract_payment_records_until timestamptz not null,
  complaint_dispute_records_until timestamptz not null,
  legal_records_until timestamptz not null,
  legal_hold_until timestamptz,
  legal_hold_reason text,
  direct_identifiers_deleted_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  check (contract_payment_records_until >= withdrawn_at),
  check (complaint_dispute_records_until >= withdrawn_at),
  check (legal_records_until >= contract_payment_records_until),
  check (legal_records_until >= complaint_dispute_records_until),
  check (legal_hold_until is null or legal_hold_until >= withdrawn_at),
  check (legal_hold_reason is null or char_length(legal_hold_reason) between 2 and 500),
  check (
    (legal_hold_until is null and legal_hold_reason is null)
    or (legal_hold_until is not null and legal_hold_reason is not null)
  )
);

create table if not exists shorts_mvp.account_withdrawal_legal_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  record_type text not null check (
    record_type in ('service_supply','paid_feature_supply')
  ),
  source_id uuid not null,
  billing_order_id uuid references shorts_mvp.billing_orders(id) on delete set null,
  subscription_id uuid references shorts_mvp.user_subscriptions(id) on delete set null,
  service_code text not null,
  quantity integer not null check (quantity >= 0),
  occurred_at timestamptz not null,
  retention_until timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (record_type,source_id),
  check (retention_until >= occurred_at)
);

create index if not exists app_users_withdrawn_at_idx
  on shorts_mvp.app_users (withdrawn_at)
  where withdrawn_at is not null;

create index if not exists account_withdrawal_retention_due_idx
  on shorts_mvp.account_withdrawal_retention (
    greatest(legal_records_until,coalesce(legal_hold_until,legal_records_until))
  );

create index if not exists account_withdrawal_legal_records_due_idx
  on shorts_mvp.account_withdrawal_legal_records (retention_until);

alter table shorts_mvp.account_withdrawal_retention enable row level security;
alter table shorts_mvp.account_withdrawal_legal_records enable row level security;
revoke all on table shorts_mvp.account_withdrawal_retention from anon, authenticated;
revoke all on table shorts_mvp.account_withdrawal_legal_records from anon, authenticated;
grant all on table shorts_mvp.account_withdrawal_retention to service_role;
grant all on table shorts_mvp.account_withdrawal_legal_records to service_role;

comment on column shorts_mvp.app_users.withdrawn_at is
  'Account withdrawal completion time. Billing records may retain this pseudonymous user row for statutory retention.';

comment on table shorts_mvp.account_withdrawal_retention is
  'Service-role-only retention schedule for pseudonymous statutory records after direct account identifiers are deleted.';

comment on column shorts_mvp.account_withdrawal_retention.legal_hold_until is
  'Optional extension supported by a documented live dispute, investigation, litigation, or other legal basis.';

comment on table shorts_mvp.account_withdrawal_legal_records is
  'Minimal service-supply evidence copied out of operational account data before account withdrawal.';

comment on column shorts_mvp.account_withdrawal_legal_records.retention_until is
  'Record-specific deletion deadline. A documented legal hold may delay deletion when a live dispute requires it.';

commit;
