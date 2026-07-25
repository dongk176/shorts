begin;

-- Paid entitlements are server-owned. The legacy selected_plan_code columns are
-- retained as compatibility caches only and default to the non-paying plan.
alter table shorts_mvp.plans drop constraint if exists plans_code_check;
alter table shorts_mvp.plans drop constraint if exists plans_monthly_source_seconds_check;
alter table shorts_mvp.plans
  add constraint plans_code_check check (code in (
    'free','plus','standard','pro',
    'easycut_pro_v2',
    'starter_3m','starter_6m','starter_12m',
    'expert_3m','expert_6m','expert_12m'
  ));
alter table shorts_mvp.plans
  add constraint plans_monthly_source_seconds_check check (monthly_source_seconds >= 0);
alter table shorts_mvp.plans
  add column if not exists monthly_price_krw integer not null default 0,
  add column if not exists yearly_price_krw integer not null default 0,
  add column if not exists max_active_jobs integer not null default 0;
alter table shorts_mvp.plans drop constraint if exists plans_monthly_price_krw_check;
alter table shorts_mvp.plans add constraint plans_monthly_price_krw_check
  check (monthly_price_krw >= 0);
alter table shorts_mvp.plans drop constraint if exists plans_yearly_price_krw_check;
alter table shorts_mvp.plans add constraint plans_yearly_price_krw_check
  check (yearly_price_krw >= 0);
alter table shorts_mvp.plans drop constraint if exists plans_max_active_jobs_check;
alter table shorts_mvp.plans add constraint plans_max_active_jobs_check
  check (max_active_jobs between 0 and 3);

insert into shorts_mvp.plans (
  code, display_name, monthly_source_seconds, retention_days, sort_order,
  monthly_price_krw, yearly_price_krw, max_active_jobs, is_active
) values
  ('free','Free',0,1,0,0,0,0,true),
  ('plus','Plus',6000,7,10,9900,95040,1,true),
  ('standard','Standard',12000,15,20,19900,191040,2,true),
  ('pro','Pro',36000,30,30,49900,479040,3,true)
on conflict (code) do update set
  display_name=excluded.display_name,
  monthly_source_seconds=excluded.monthly_source_seconds,
  retention_days=excluded.retention_days,
  sort_order=excluded.sort_order,
  monthly_price_krw=excluded.monthly_price_krw,
  yearly_price_krw=excluded.yearly_price_krw,
  max_active_jobs=excluded.max_active_jobs,
  is_active=excluded.is_active,
  updated_at=now();

alter table shorts_mvp.app_users
  alter column selected_plan_code set default 'free';
alter table shorts_mvp.mvp_sessions
  alter column selected_plan_code set default 'free';
create table if not exists shorts_mvp.addon_products (
  code text primary key,
  display_name text not null,
  seconds integer not null check (seconds > 0),
  price_krw integer not null check (price_krw > 0),
  validity_days integer not null default 90 check (validity_days between 1 and 365),
  sort_order integer not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into shorts_mvp.addon_products
  (code,display_name,seconds,price_krw,validity_days,sort_order)
values
  ('minutes_50','추가 50분',3000,5900,90,10),
  ('minutes_100','추가 100분',6000,9900,90,20),
  ('minutes_300','추가 300분',18000,24900,90,30)
on conflict (code) do update set
  display_name=excluded.display_name,
  seconds=excluded.seconds,
  price_krw=excluded.price_krw,
  validity_days=excluded.validity_days,
  sort_order=excluded.sort_order,
  is_active=true,
  updated_at=now();

create table if not exists shorts_mvp.billing_payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  billing_key_ciphertext text not null,
  billing_key_iv text not null,
  billing_key_tag text not null,
  billing_key_hash text not null unique check (length(billing_key_hash)=64),
  issuer_code text,
  issuer_name text,
  card_number_masked text,
  card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  card_type text,
  registration_order_id text,
  registration_transaction_id text,
  registration_result_code text,
  status text not null default 'active' check (status in ('active','replaced','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists billing_payment_methods_user_created_idx
  on shorts_mvp.billing_payment_methods (user_id,created_at desc);
alter table shorts_mvp.billing_payment_methods
  add column if not exists card_number_masked text;
alter table shorts_mvp.billing_payment_methods
  drop constraint if exists billing_payment_methods_card_number_masked_check;
alter table shorts_mvp.billing_payment_methods
  add constraint billing_payment_methods_card_number_masked_check
  check (card_number_masked is null or char_length(card_number_masked) between 4 and 32);

alter table shorts_mvp.user_subscriptions
  drop constraint if exists user_subscriptions_status_check;
alter table shorts_mvp.user_subscriptions
  add constraint user_subscriptions_status_check
  check (status in ('pending','trialing','active','past_due','canceled','expired'));
alter table shorts_mvp.user_subscriptions
  add column if not exists billing_cycle text,
  add column if not exists payment_method_id uuid references shorts_mvp.billing_payment_methods(id) on delete set null,
  add column if not exists next_charge_at timestamptz,
  add column if not exists next_quota_at timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists scheduled_plan_code text references shorts_mvp.plans(code),
  add column if not exists scheduled_billing_cycle text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists grace_ends_at timestamptz,
  add column if not exists canceled_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists billing_anchor_day integer;
alter table shorts_mvp.user_subscriptions
  drop constraint if exists user_subscriptions_billing_cycle_check;
alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_billing_cycle_check
  check (billing_cycle is null or billing_cycle in ('monthly','yearly'));
alter table shorts_mvp.user_subscriptions
  drop constraint if exists user_subscriptions_scheduled_billing_cycle_check;
alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_scheduled_billing_cycle_check
  check (scheduled_billing_cycle is null or scheduled_billing_cycle in ('monthly','yearly'));
alter table shorts_mvp.user_subscriptions
  drop constraint if exists user_subscriptions_retry_count_check;
alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_retry_count_check
  check (retry_count between 0 and 3);
alter table shorts_mvp.user_subscriptions
  drop constraint if exists user_subscriptions_billing_anchor_day_check;
alter table shorts_mvp.user_subscriptions add constraint user_subscriptions_billing_anchor_day_check
  check (billing_anchor_day is null or billing_anchor_day between 1 and 31);
create unique index if not exists user_subscriptions_one_current_idx
  on shorts_mvp.user_subscriptions (user_id)
  where status in ('pending','trialing','active','past_due');
create index if not exists user_subscriptions_charge_due_idx
  on shorts_mvp.user_subscriptions (coalesce(next_retry_at,next_charge_at))
  where status in ('active','past_due');
create index if not exists user_subscriptions_quota_due_idx
  on shorts_mvp.user_subscriptions (next_quota_at)
  where status='active';

create table if not exists shorts_mvp.billing_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  subscription_id uuid references shorts_mvp.user_subscriptions(id) on delete set null,
  payment_method_id uuid references shorts_mvp.billing_payment_methods(id) on delete set null,
  request_id uuid not null unique,
  kind text not null check (kind in (
    'subscription_initial','subscription_renewal','addon','payment_method_update'
  )),
  product_code text not null,
  billing_cycle text check (billing_cycle is null or billing_cycle in ('monthly','yearly')),
  amount_krw integer not null check (amount_krw >= 0),
  order_id text not null unique check (char_length(order_id) between 6 and 64),
  order_name text not null check (char_length(order_name) between 1 and 100),
  status text not null default 'pending' check (status in (
    'pending','processing','succeeded','failed','unknown','canceled','expired'
  )),
  provider_transaction_id text unique,
  provider_status text,
  failure_code text,
  failure_message text,
  renewal_period_start timestamptz,
  checkout_expires_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists billing_orders_user_created_idx
  on shorts_mvp.billing_orders (user_id,created_at desc);
create index if not exists billing_orders_pending_expiry_idx
  on shorts_mvp.billing_orders (checkout_expires_at)
  where status='pending';
create unique index if not exists billing_orders_one_renewal_period_idx
  on shorts_mvp.billing_orders (subscription_id,renewal_period_start)
  where kind='subscription_renewal' and renewal_period_start is not null;

create table if not exists shorts_mvp.billing_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references shorts_mvp.billing_orders(id) on delete cascade,
  attempt_no integer not null check (attempt_no between 1 and 10),
  provider_order_id text not null unique,
  status text not null default 'processing' check (status in ('processing','succeeded','failed','unknown')),
  provider_transaction_id text unique,
  provider_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (order_id,attempt_no)
);

create table if not exists shorts_mvp.usage_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  subscription_id uuid references shorts_mvp.user_subscriptions(id) on delete cascade,
  billing_order_id uuid references shorts_mvp.billing_orders(id) on delete restrict,
  kind text not null check (kind in ('base','addon')),
  product_code text not null,
  total_seconds integer not null check (total_seconds > 0),
  reserved_seconds integer not null default 0 check (reserved_seconds >= 0),
  consumed_seconds integer not null default 0 check (consumed_seconds >= 0),
  valid_from timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active','expired','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > valid_from),
  check (reserved_seconds + consumed_seconds <= total_seconds)
);
create unique index if not exists usage_grants_subscription_period_idx
  on shorts_mvp.usage_grants (subscription_id,valid_from,kind)
  where subscription_id is not null and kind='base';
create unique index if not exists usage_grants_addon_order_idx
  on shorts_mvp.usage_grants (billing_order_id)
  where kind='addon';
create index if not exists usage_grants_available_idx
  on shorts_mvp.usage_grants (user_id,kind,expires_at)
  where status='active';

create table if not exists shorts_mvp.usage_grant_allocations (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references shorts_mvp.usage_reservations(id) on delete cascade,
  grant_id uuid not null references shorts_mvp.usage_grants(id) on delete restrict,
  allocated_seconds integer not null check (allocated_seconds > 0),
  status text not null default 'reserved' check (status in ('reserved','consumed','released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reservation_id,grant_id)
);
create index if not exists usage_grant_allocations_grant_idx
  on shorts_mvp.usage_grant_allocations (grant_id,status);

alter table shorts_mvp.video_jobs
  add column if not exists retention_days_snapshot integer;
update shorts_mvp.video_jobs j
set retention_days_snapshot=p.retention_days
from shorts_mvp.mvp_sessions s
join shorts_mvp.plans p on p.code=s.selected_plan_code
where s.id=j.mvp_session_id and j.retention_days_snapshot is null;
update shorts_mvp.video_jobs set retention_days_snapshot=30
where retention_days_snapshot is null;
alter table shorts_mvp.video_jobs alter column retention_days_snapshot set not null;
alter table shorts_mvp.video_jobs alter column retention_days_snapshot set default 30;
alter table shorts_mvp.video_jobs drop constraint if exists video_jobs_retention_days_snapshot_check;
alter table shorts_mvp.video_jobs add constraint video_jobs_retention_days_snapshot_check
  check (retention_days_snapshot between 1 and 30);

create or replace function shorts_mvp.reserve_usage_grants(
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
  if p_seconds <= 0 then
    raise exception '사용량 예약 시간이 올바르지 않습니다.';
  end if;

  if not exists (
    select 1
    from shorts_mvp.usage_reservations r
    where r.id=p_reservation_id and r.user_id=p_user_id
      and r.status='reserved' and r.source_duration_seconds=p_seconds
  ) then
    raise exception '사용량 예약 정보를 확인할 수 없습니다.';
  end if;

  if not exists (
    select 1 from shorts_mvp.user_subscriptions s
    where s.user_id=p_user_id and s.status='active'
      and s.current_period_start <= clock_timestamp()
      and s.current_period_end > clock_timestamp()
  ) then
    raise exception '활성 구독이 필요합니다.';
  end if;

  for grant_row in
    select g.id, g.total_seconds-g.reserved_seconds-g.consumed_seconds as available_seconds
    from shorts_mvp.usage_grants g
    where g.user_id=p_user_id and g.status='active'
      and g.valid_from <= clock_timestamp() and g.expires_at > clock_timestamp()
      and g.total_seconds > g.reserved_seconds+g.consumed_seconds
    order by case when g.kind='base' then 0 else 1 end,
      case when g.kind='base' then g.valid_from end desc,
      g.expires_at, g.created_at
    for update
  loop
    exit when remaining=0;
    allocation := least(remaining,grant_row.available_seconds);
    update shorts_mvp.usage_grants
    set reserved_seconds=reserved_seconds+allocation,updated_at=clock_timestamp()
    where id=grant_row.id;
    insert into shorts_mvp.usage_grant_allocations
      (reservation_id,grant_id,allocated_seconds)
    values (p_reservation_id,grant_row.id,allocation);
    remaining := remaining-allocation;
  end loop;

  if remaining > 0 then
    raise exception '사용 가능한 원본 영상 처리 시간이 부족합니다.';
  end if;
end;
$$;

create or replace function shorts_mvp.apply_usage_reservation_transition()
returns trigger
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
begin
  if old.status <> 'reserved' or new.status not in ('consumed','released') then
    return new;
  end if;

  if new.status='consumed' then
    update shorts_mvp.usage_grants g
    set reserved_seconds=g.reserved_seconds-a.allocated_seconds,
        consumed_seconds=g.consumed_seconds+a.allocated_seconds,
        updated_at=clock_timestamp()
    from shorts_mvp.usage_grant_allocations a
    where a.reservation_id=new.id and a.grant_id=g.id and a.status='reserved';
    update shorts_mvp.usage_grant_allocations
    set status='consumed',updated_at=clock_timestamp()
    where reservation_id=new.id and status='reserved';
  else
    update shorts_mvp.usage_grants g
    set reserved_seconds=g.reserved_seconds-a.allocated_seconds,
        updated_at=clock_timestamp()
    from shorts_mvp.usage_grant_allocations a
    where a.reservation_id=new.id and a.grant_id=g.id and a.status='reserved';
    update shorts_mvp.usage_grant_allocations
    set status='released',updated_at=clock_timestamp()
    where reservation_id=new.id and status='reserved';
  end if;
  return new;
end;
$$;

drop trigger if exists usage_reservations_apply_grants on shorts_mvp.usage_reservations;
create trigger usage_reservations_apply_grants
after update of status on shorts_mvp.usage_reservations
for each row execute function shorts_mvp.apply_usage_reservation_transition();

-- Legacy placeholder subscriptions have no provider-backed payment method and
-- must not become paid access after the entitlement cutover.
update shorts_mvp.user_subscriptions
set status='expired',ended_at=coalesce(ended_at,now()),next_charge_at=null,
  next_retry_at=null,next_quota_at=null
where status in ('pending','trialing','active','past_due')
  and (payment_method_id is null or billing_cycle is null);

-- Existing MVP-selected paid plans must not become paid access without a
-- provider-backed subscription.
update shorts_mvp.app_users u set selected_plan_code='free'
where not exists (
  select 1 from shorts_mvp.user_subscriptions s
  where s.user_id=u.id and s.status in ('trialing','active','past_due')
);
update shorts_mvp.mvp_sessions s set selected_plan_code=coalesce((
  select u.selected_plan_code from shorts_mvp.app_users u where u.id=s.user_id
),'free');

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'addon_products','billing_payment_methods','billing_orders','billing_attempts',
    'usage_grants','usage_grant_allocations'
  ] loop
    execute format('alter table shorts_mvp.%I enable row level security',table_name);
    execute format('revoke all on shorts_mvp.%I from anon, authenticated',table_name);
    execute format('grant all on shorts_mvp.%I to service_role',table_name);
  end loop;
end $$;

drop trigger if exists addon_products_set_updated_at on shorts_mvp.addon_products;
create trigger addon_products_set_updated_at before update on shorts_mvp.addon_products
for each row execute function shorts_mvp.set_updated_at();
drop trigger if exists billing_payment_methods_set_updated_at on shorts_mvp.billing_payment_methods;
create trigger billing_payment_methods_set_updated_at before update on shorts_mvp.billing_payment_methods
for each row execute function shorts_mvp.set_updated_at();
drop trigger if exists billing_orders_set_updated_at on shorts_mvp.billing_orders;
create trigger billing_orders_set_updated_at before update on shorts_mvp.billing_orders
for each row execute function shorts_mvp.set_updated_at();
drop trigger if exists usage_grants_set_updated_at on shorts_mvp.usage_grants;
create trigger usage_grants_set_updated_at before update on shorts_mvp.usage_grants
for each row execute function shorts_mvp.set_updated_at();
drop trigger if exists usage_grant_allocations_set_updated_at on shorts_mvp.usage_grant_allocations;
create trigger usage_grant_allocations_set_updated_at before update on shorts_mvp.usage_grant_allocations
for each row execute function shorts_mvp.set_updated_at();

revoke all on function shorts_mvp.reserve_usage_grants(uuid,uuid,integer)
  from public,anon,authenticated;
grant execute on function shorts_mvp.reserve_usage_grants(uuid,uuid,integer)
  to service_role;

commit;
