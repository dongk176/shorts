begin;

-- Keep the amount and billing day used when a ThePayOne cardId was issued.
-- Historical rows remain nullable because the provider does not expose these
-- values through a read API.
alter table shorts_mvp.billing_payment_methods
  add column if not exists registration_amount_krw integer,
  add column if not exists registration_billing_day integer;

alter table shorts_mvp.billing_payment_methods
  drop constraint if exists billing_payment_methods_registration_amount_check,
  drop constraint if exists billing_payment_methods_registration_billing_day_check;
alter table shorts_mvp.billing_payment_methods
  add constraint billing_payment_methods_registration_amount_check
    check (registration_amount_krw is null or registration_amount_krw >= 0),
  add constraint billing_payment_methods_registration_billing_day_check
    check (
      registration_billing_day is null
      or registration_billing_day between 0 and 28
    );

create table if not exists shorts_mvp.billing_payment_method_remediations (
  id uuid primary key default gen_random_uuid(),
  campaign_key text not null default 'legacy_easycut_pro_202608'
    check (char_length(campaign_key) between 2 and 100),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  subscription_id uuid not null references shorts_mvp.user_subscriptions(id) on delete restrict,
  legacy_payment_method_id uuid not null references shorts_mvp.billing_payment_methods(id) on delete restrict,
  original_next_charge_at timestamptz not null,
  original_current_period_end timestamptz not null,
  billing_anchor_day integer not null check (billing_anchor_day between 1 and 28),
  expected_product_code text not null default 'easycut_pro_v2'
    check (expected_product_code='easycut_pro_v2'),
  expected_amount_krw integer not null default 9900
    check (expected_amount_krw=9900),
  eligibility_cutoff timestamptz not null,
  state text not null default 'required' check (state in (
    'required','registering','awaiting_provider','completed','expired',
    'manual_review','superseded'
  )),
  resolution text check (resolution is null or resolution in (
    'user_reregistered','provider_9900_renewal','provider_zero_event',
    'provider_no_event','provider_wrong_amount','admin'
  )),
  request_id uuid,
  registration_track_id text,
  new_payment_method_id uuid references shorts_mvp.billing_payment_methods(id) on delete set null,
  enabled_at timestamptz,
  claim_started_at timestamptz,
  completed_at timestamptz,
  expired_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_key,user_id),
  unique (campaign_key,subscription_id),
  unique (campaign_key,legacy_payment_method_id),
  unique (request_id),
  unique (registration_track_id),
  check (original_next_charge_at=original_current_period_end),
  check (
    (state='completed' and completed_at is not null and resolution is not null)
    or state<>'completed'
  ),
  check (
    (state='expired' and expired_at is not null and resolution is not null)
    or state<>'expired'
  )
);

create index if not exists billing_payment_method_remediations_state_idx
  on shorts_mvp.billing_payment_method_remediations (state,original_next_charge_at);
create index if not exists billing_payment_method_remediations_enabled_idx
  on shorts_mvp.billing_payment_method_remediations (enabled_at,state)
  where enabled_at is not null;

create table if not exists shorts_mvp.billing_payment_method_remediation_attempts (
  id uuid primary key default gen_random_uuid(),
  remediation_id uuid not null
    references shorts_mvp.billing_payment_method_remediations(id) on delete cascade,
  billing_order_id uuid not null
    references shorts_mvp.billing_orders(id) on delete restrict,
  request_id uuid not null unique,
  registration_track_id text not null unique,
  status text not null default 'registering' check (status in (
    'registering','registered','completed','known_failed','compensated','manual_review'
  )),
  new_payment_method_id uuid
    references shorts_mvp.billing_payment_methods(id) on delete set null,
  registration_transaction_id text,
  issued_card_ciphertext text,
  issued_card_iv text,
  issued_card_tag text,
  issued_card_hash text check (issued_card_hash is null or length(issued_card_hash)=64),
  old_schedule_paused boolean,
  new_schedule_compensated boolean,
  failure_code text,
  failure_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (billing_order_id),
  check (
    (issued_card_ciphertext is null and issued_card_iv is null and issued_card_tag is null)
    or
    (issued_card_ciphertext is not null and issued_card_iv is not null and issued_card_tag is not null)
  )
);

create index if not exists billing_payment_method_remediation_attempts_state_idx
  on shorts_mvp.billing_payment_method_remediation_attempts (status,started_at);

insert into shorts_mvp.runtime_feature_flags (flag_key,enabled,description)
values
  (
    'legacy_recurring_card_claims',
    false,
    '기존 이지컷 프로 사용자의 결제수단 재등록 오버레이 및 신규 카드 등록'
  ),
  (
    'legacy_recurring_card_reconciliation',
    false,
    '기존 정기결제 카드의 실제 PG 결과 및 무응답 만료 처리'
  )
on conflict (flag_key) do nothing;

alter table shorts_mvp.billing_payment_method_remediations enable row level security;
alter table shorts_mvp.billing_payment_method_remediation_attempts enable row level security;
revoke all on shorts_mvp.billing_payment_method_remediations from anon, authenticated;
revoke all on shorts_mvp.billing_payment_method_remediation_attempts from anon, authenticated;
grant all on shorts_mvp.billing_payment_method_remediations to service_role;
grant all on shorts_mvp.billing_payment_method_remediation_attempts to service_role;

drop trigger if exists billing_payment_method_remediations_set_updated_at
  on shorts_mvp.billing_payment_method_remediations;
create trigger billing_payment_method_remediations_set_updated_at
before update on shorts_mvp.billing_payment_method_remediations
for each row execute function shorts_mvp.set_updated_at();

drop trigger if exists billing_payment_method_remediation_attempts_set_updated_at
  on shorts_mvp.billing_payment_method_remediation_attempts;
create trigger billing_payment_method_remediation_attempts_set_updated_at
before update on shorts_mvp.billing_payment_method_remediation_attempts
for each row execute function shorts_mvp.set_updated_at();

comment on table shorts_mvp.billing_payment_method_remediations is
  'Immutable billing-date snapshots and state for the August 2026 legacy EasyCut Pro cardId remediation.';
comment on table shorts_mvp.billing_payment_method_remediation_attempts is
  'Crash-safe provider registration attempts for legacy recurring-card remediation.';

commit;
