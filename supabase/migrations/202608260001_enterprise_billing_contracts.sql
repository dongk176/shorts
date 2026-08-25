begin;

-- Additive enterprise-only billing data. Existing general-payment requests and
-- all personal subscription rows are deliberately left untouched.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table shorts_mvp.enterprise_payment_requests
  add column if not exists payment_mode text not null default 'general',
  add column if not exists blocks_service_access boolean not null default false,
  add column if not exists purchase_terms_version smallint,
  add column if not exists purchase_terms_hash text,
  add column if not exists refund_policy_version smallint,
  add column if not exists refund_policy_hash text,
  add column if not exists consent_copy_version smallint,
  add column if not exists consented_at timestamptz,
  add column if not exists entitlements_granted_at timestamptz;

alter table shorts_mvp.enterprise_payment_requests
  drop constraint if exists enterprise_payment_requests_payment_mode_check,
  drop constraint if exists enterprise_payment_requests_legal_snapshot_check;
alter table shorts_mvp.enterprise_payment_requests
  add constraint enterprise_payment_requests_payment_mode_check
    check (payment_mode in ('general','billing')) not valid,
  add constraint enterprise_payment_requests_legal_snapshot_check check (
    payment_mode='general'
    or (
      purchase_terms_version is not null
      and char_length(purchase_terms_hash)=64
      and refund_policy_version is not null
      and char_length(refund_policy_hash)=64
      and consent_copy_version is not null
    )
  ) not valid;

create unique index if not exists enterprise_payment_requests_one_blocking_open_idx
  on shorts_mvp.enterprise_payment_requests (managed_account_id)
  where blocks_service_access=true and status in ('open','partial');

alter table shorts_mvp.enterprise_payment_items
  add column if not exists service_start_date date,
  add column if not exists service_end_date date,
  add column if not exists duration_value integer,
  add column if not exists duration_unit text,
  add column if not exists included_minutes integer,
  add column if not exists vat_treatment text,
  add column if not exists payment_due_date date;

alter table shorts_mvp.enterprise_payment_items
  drop constraint if exists enterprise_payment_items_duration_check,
  drop constraint if exists enterprise_payment_items_contract_fields_check;
alter table shorts_mvp.enterprise_payment_items
  add constraint enterprise_payment_items_duration_check check (
    duration_unit is null
    or (duration_unit='days' and duration_value between 1 and 3650)
    or (duration_unit='months' and duration_value between 1 and 120)
  ) not valid,
  add constraint enterprise_payment_items_contract_fields_check check (
    service_start_date is null
    or (
      service_end_date>=service_start_date
      and duration_value is not null
      and duration_unit in ('days','months')
      and included_minutes between 1 and 100000
      and vat_treatment in ('included','not_applicable')
      and payment_due_date is not null
    )
  ) not valid;

create table if not exists shorts_mvp.enterprise_payment_consents (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null unique
    references shorts_mvp.enterprise_payment_requests(id) on delete restrict,
  managed_account_id uuid not null
    references shorts_mvp.managed_login_accounts(id) on delete restrict,
  app_user_id uuid not null references shorts_mvp.app_users(id) on delete restrict,
  purchase_terms_version smallint not null,
  purchase_terms_hash text not null check (char_length(purchase_terms_hash)=64),
  refund_policy_version smallint not null,
  refund_policy_hash text not null check (char_length(refund_policy_hash)=64),
  consent_copy_version smallint not null,
  purchase_terms_agreed boolean not null,
  refund_policy_agreed boolean not null,
  stored_card_charge_agreed boolean not null,
  agreed_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  check (purchase_terms_agreed and refund_policy_agreed and stored_card_charge_agreed)
);

create index if not exists enterprise_payment_consents_account_created_idx
  on shorts_mvp.enterprise_payment_consents (managed_account_id,created_at desc);

create table if not exists shorts_mvp.enterprise_billing_profiles (
  id uuid primary key default gen_random_uuid(),
  managed_account_id uuid not null unique
    references shorts_mvp.managed_login_accounts(id) on delete restrict,
  app_user_id uuid not null unique references shorts_mvp.app_users(id) on delete restrict,
  payment_method_id uuid unique
    references shorts_mvp.billing_payment_methods(id) on delete restrict,
  status text not null default 'unregistered' check (
    status in ('unregistered','registration_pending','active','manual_review')
  ),
  registered_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((status='active')=(payment_method_id is not null and registered_at is not null))
);

create table if not exists shorts_mvp.enterprise_billing_registration_intents (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null
    references shorts_mvp.enterprise_payment_requests(id) on delete restrict,
  managed_account_id uuid not null
    references shorts_mvp.managed_login_accounts(id) on delete restrict,
  app_user_id uuid not null references shorts_mvp.app_users(id) on delete restrict,
  payment_method_id uuid not null unique,
  status text not null default 'prepared' check (
    status in ('prepared','issuing','issued','failed','expired','manual_review')
  ),
  expires_at timestamptz not null,
  completed_at timestamptz,
  failure_code text check (failure_code is null or char_length(failure_code)<=100),
  failure_message text check (failure_message is null or char_length(failure_message)<=300),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (expires_at>created_at)
);

alter table shorts_mvp.enterprise_billing_registration_intents
  drop constraint if exists enterprise_billing_registration_intents_status_check;
alter table shorts_mvp.enterprise_billing_registration_intents
  add constraint enterprise_billing_registration_intents_status_check check (
    status in ('prepared','issuing','issued','failed','expired','manual_review')
  ) not valid;

create unique index if not exists enterprise_billing_intents_one_live_per_request_idx
  on shorts_mvp.enterprise_billing_registration_intents (payment_request_id)
  where status in ('prepared','issuing','manual_review');

create table if not exists shorts_mvp.enterprise_service_entitlements (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null
    references shorts_mvp.enterprise_payment_requests(id) on delete restrict,
  payment_item_id uuid not null unique
    references shorts_mvp.enterprise_payment_items(id) on delete restrict,
  managed_account_id uuid not null
    references shorts_mvp.managed_login_accounts(id) on delete restrict,
  app_user_id uuid not null references shorts_mvp.app_users(id) on delete restrict,
  usage_grant_id uuid not null unique references shorts_mvp.usage_grants(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  included_seconds integer not null check (included_seconds>0),
  created_at timestamptz not null default clock_timestamp(),
  check (ends_at>starts_at)
);

create index if not exists enterprise_service_entitlements_user_period_idx
  on shorts_mvp.enterprise_service_entitlements (app_user_id,starts_at,ends_at);

alter table shorts_mvp.enterprise_payment_attempts
  add column if not exists consent_id uuid
    references shorts_mvp.enterprise_payment_consents(id) on delete restrict,
  add column if not exists payment_method_id uuid
    references shorts_mvp.billing_payment_methods(id) on delete restrict,
  add column if not exists idempotency_key text;
alter table shorts_mvp.enterprise_payment_attempts
  add column if not exists attempt_no smallint not null default 1;
alter table shorts_mvp.enterprise_payment_attempts
  drop constraint if exists enterprise_payment_attempts_attempt_no_check;
alter table shorts_mvp.enterprise_payment_attempts
  add constraint enterprise_payment_attempts_attempt_no_check
    check (attempt_no between 1 and 10) not valid;
create unique index if not exists enterprise_payment_attempts_idempotency_idx
  on shorts_mvp.enterprise_payment_attempts (idempotency_key)
  where idempotency_key is not null;
create unique index if not exists enterprise_payment_attempts_item_attempt_no_idx
  on shorts_mvp.enterprise_payment_attempts (payment_item_id,attempt_no)
  where idempotency_key is not null;

alter table shorts_mvp.enterprise_payment_consents enable row level security;
alter table shorts_mvp.enterprise_billing_profiles enable row level security;
alter table shorts_mvp.enterprise_billing_registration_intents enable row level security;
alter table shorts_mvp.enterprise_service_entitlements enable row level security;

revoke all on shorts_mvp.enterprise_payment_consents from anon, authenticated;
revoke all on shorts_mvp.enterprise_billing_profiles from anon, authenticated;
revoke all on shorts_mvp.enterprise_billing_registration_intents from anon, authenticated;
revoke all on shorts_mvp.enterprise_service_entitlements from anon, authenticated;
grant all on shorts_mvp.enterprise_payment_consents to service_role;
grant all on shorts_mvp.enterprise_billing_profiles to service_role;
grant all on shorts_mvp.enterprise_billing_registration_intents to service_role;
grant all on shorts_mvp.enterprise_service_entitlements to service_role;

drop trigger if exists enterprise_billing_profiles_set_updated_at
  on shorts_mvp.enterprise_billing_profiles;
create trigger enterprise_billing_profiles_set_updated_at
before update on shorts_mvp.enterprise_billing_profiles
for each row execute function shorts_mvp.set_updated_at();

drop trigger if exists enterprise_billing_registration_intents_set_updated_at
  on shorts_mvp.enterprise_billing_registration_intents;
create trigger enterprise_billing_registration_intents_set_updated_at
before update on shorts_mvp.enterprise_billing_registration_intents
for each row execute function shorts_mvp.set_updated_at();

insert into shorts_mvp.runtime_feature_flags (flag_key,enabled,description)
values (
  'toss_enterprise_billing',false,
  '기업 발급계정의 카드등록 및 상품별 순차 빌링 승인 허용'
)
on conflict (flag_key) do nothing;

-- Fulfillment is locked per request and linked one-to-one to every item, so
-- a provider retry or reconciliation cannot issue processing time twice.
create or replace function shorts_mvp.fulfill_enterprise_payment_request(
  p_payment_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  request_row record;
  item_row record;
  grant_id uuid;
  starts_at timestamptz;
  ends_at timestamptz;
begin
  select payment_request.*,managed.app_user_id
  into request_row
  from shorts_mvp.enterprise_payment_requests payment_request
  join shorts_mvp.managed_login_accounts managed
    on managed.id=payment_request.managed_account_id
  where payment_request.id=p_payment_request_id
  for update of payment_request;

  if request_row.id is null or request_row.payment_mode<>'billing' then return; end if;
  if exists (
    select 1 from shorts_mvp.enterprise_payment_items item
    where item.payment_request_id=p_payment_request_id and item.status<>'paid'
  ) then return; end if;

  for item_row in
    select item.* from shorts_mvp.enterprise_payment_items item
    where item.payment_request_id=p_payment_request_id
    order by item.sort_order for update
  loop
    if not exists (
      select 1 from shorts_mvp.enterprise_service_entitlements entitlement
      where entitlement.payment_item_id=item_row.id
    ) then
      starts_at := item_row.service_start_date::timestamp at time zone 'Asia/Seoul';
      ends_at := (item_row.service_end_date+1)::timestamp at time zone 'Asia/Seoul';
      grant_id := gen_random_uuid();
      insert into shorts_mvp.usage_grants (
        id,user_id,kind,product_code,total_seconds,credited_seconds,carried_seconds,
        valid_from,expires_at,status
      ) values (
        grant_id,request_row.app_user_id,'addon',
        'enterprise_contract:'||item_row.id::text,item_row.included_minutes*60,
        item_row.included_minutes*60,0,starts_at,ends_at,'active'
      );
      insert into shorts_mvp.enterprise_service_entitlements (
        payment_request_id,payment_item_id,managed_account_id,app_user_id,
        usage_grant_id,starts_at,ends_at,included_seconds
      ) values (
        p_payment_request_id,item_row.id,request_row.managed_account_id,
        request_row.app_user_id,grant_id,starts_at,ends_at,item_row.included_minutes*60
      );
    end if;
  end loop;
  update shorts_mvp.enterprise_payment_requests
  set entitlements_granted_at=coalesce(entitlements_granted_at,clock_timestamp())
  where id=p_payment_request_id;
end;
$$;

revoke all on function shorts_mvp.fulfill_enterprise_payment_request(uuid)
  from public, anon, authenticated;
grant execute on function shorts_mvp.fulfill_enterprise_payment_request(uuid)
  to service_role;

-- A separate function reserves only active enterprise grants. Personal users
-- keep using the existing, unchanged reserve_usage_grants function.
create or replace function shorts_mvp.reserve_enterprise_usage_grants(
  p_user_id uuid,
  p_reservation_id uuid,
  p_seconds integer
)
returns void
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  grant_row record;
  remaining integer := p_seconds;
  allocation integer;
begin
  if p_seconds<=0 then raise exception '사용량 예약 시간이 올바르지 않습니다.'; end if;
  if not exists (
    select 1 from shorts_mvp.usage_reservations reservation
    where reservation.id=p_reservation_id and reservation.user_id=p_user_id
      and reservation.status='reserved'
      and reservation.source_duration_seconds=p_seconds
  ) then raise exception '사용량 예약 정보를 확인할 수 없습니다.'; end if;
  if not exists (
    select 1 from shorts_mvp.enterprise_service_entitlements entitlement
    where entitlement.app_user_id=p_user_id
      and entitlement.starts_at<=clock_timestamp()
      and entitlement.ends_at>clock_timestamp()
  ) then raise exception '현재 이용 가능한 기업 서비스 기간이 아닙니다.'; end if;

  for grant_row in
    select usage_grant.id,
      usage_grant.total_seconds-usage_grant.reserved_seconds-
        usage_grant.consumed_seconds as available_seconds
    from shorts_mvp.enterprise_service_entitlements entitlement
    join shorts_mvp.usage_grants usage_grant on usage_grant.id=entitlement.usage_grant_id
    where entitlement.app_user_id=p_user_id
      and entitlement.starts_at<=clock_timestamp() and entitlement.ends_at>clock_timestamp()
      and usage_grant.status='active' and usage_grant.valid_from<=clock_timestamp()
      and usage_grant.expires_at>clock_timestamp()
      and usage_grant.total_seconds>usage_grant.reserved_seconds+usage_grant.consumed_seconds
    order by usage_grant.expires_at,usage_grant.created_at
    for update of usage_grant
  loop
    exit when remaining=0;
    allocation := least(remaining,grant_row.available_seconds);
    update shorts_mvp.usage_grants
    set reserved_seconds=reserved_seconds+allocation,updated_at=clock_timestamp()
    where id=grant_row.id;
    insert into shorts_mvp.usage_grant_allocations (
      reservation_id,grant_id,allocated_seconds
    ) values (p_reservation_id,grant_row.id,allocation);
    remaining := remaining-allocation;
  end loop;
  if remaining>0 then raise exception '사용 가능한 원본 영상 처리 시간이 부족합니다.'; end if;
end;
$$;

revoke all on function shorts_mvp.reserve_enterprise_usage_grants(uuid,uuid,integer)
  from public, anon, authenticated;
grant execute on function shorts_mvp.reserve_enterprise_usage_grants(uuid,uuid,integer)
  to service_role;

comment on table shorts_mvp.enterprise_payment_consents is
  'Immutable per-request enterprise legal consent snapshot.';
comment on table shorts_mvp.enterprise_service_entitlements is
  'Fixed-period enterprise access and usage-grant links created after full payment.';

commit;
