-- Upgrade refunds, installment campaigns, and user-facing activity accounting.
begin;

create table if not exists shorts_mvp.installment_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  effective_from date not null,
  effective_to date not null,
  status text not null default 'draft'
    check (status in ('draft','published','ended')),
  default_min_amount_krw integer not null default 50000
    check (default_min_amount_krw >= 0),
  notice text not null default '',
  created_by_user_id uuid references shorts_mvp.app_users(id) on delete restrict,
  published_by_user_id uuid references shorts_mvp.app_users(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to >= effective_from),
  check (
    (status = 'published' and published_at is not null)
    or status <> 'published'
  )
);
create index if not exists installment_campaigns_effective_idx
  on shorts_mvp.installment_campaigns (status,effective_from,effective_to);

create or replace function shorts_mvp.prevent_overlapping_installment_campaigns()
returns trigger
language plpgsql
set search_path = shorts_mvp, pg_temp
as $$
begin
  if new.status = 'published' and exists (
    select 1
    from shorts_mvp.installment_campaigns c
    where c.id <> new.id
      and c.status = 'published'
      and daterange(c.effective_from,c.effective_to,'[]')
        && daterange(new.effective_from,new.effective_to,'[]')
  ) then
    raise exception '게시된 할부 캠페인의 적용기간이 겹칩니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists installment_campaigns_no_overlap
  on shorts_mvp.installment_campaigns;
create trigger installment_campaigns_no_overlap
before insert or update of status,effective_from,effective_to
on shorts_mvp.installment_campaigns
for each row execute function shorts_mvp.prevent_overlapping_installment_campaigns();

create table if not exists shorts_mvp.installment_campaign_terms (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references shorts_mvp.installment_campaigns(id) on delete cascade,
  issuer_code text not null check (char_length(issuer_code) between 2 and 30),
  issuer_name text not null check (char_length(issuer_name) between 2 and 50),
  benefit_type text not null check (benefit_type in ('interest_free','partial_interest_free')),
  installment_months integer not null check (installment_months between 2 and 36),
  customer_paid_installments integer
    check (
      customer_paid_installments is null
      or customer_paid_installments between 1 and installment_months-1
    ),
  min_amount_krw integer check (min_amount_krw is null or min_amount_krw >= 0),
  display_order integer not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id,issuer_code,benefit_type,installment_months),
  check (
    (benefit_type='interest_free' and customer_paid_installments is null)
    or (benefit_type='partial_interest_free' and customer_paid_installments is not null)
  )
);
create index if not exists installment_campaign_terms_campaign_idx
  on shorts_mvp.installment_campaign_terms (campaign_id,display_order,issuer_code,installment_months);

create table if not exists shorts_mvp.payment_provider_installment_capabilities (
  provider text not null check (provider in ('thepayone')),
  installment_months integer not null check (installment_months between 2 and 36),
  enabled boolean not null default false,
  verified_at timestamptz,
  note text not null default '',
  updated_by_user_id uuid references shorts_mvp.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider,installment_months),
  check ((enabled and verified_at is not null) or not enabled)
);

alter table shorts_mvp.billing_orders
  add column if not exists provider_auth_code text,
  add column if not exists provider_transaction_day date,
  add column if not exists installment_months integer not null default 0,
  add column if not exists installment_campaign_id uuid
    references shorts_mvp.installment_campaigns(id) on delete set null,
  add column if not exists installment_terms_snapshot jsonb not null default '{}'::jsonb;
alter table shorts_mvp.billing_orders
  drop constraint if exists billing_orders_installment_months_check,
  drop constraint if exists billing_orders_installment_terms_snapshot_object;
alter table shorts_mvp.billing_orders
  add constraint billing_orders_installment_months_check
    check (installment_months between 0 and 36 and installment_months <> 1),
  add constraint billing_orders_installment_terms_snapshot_object
    check (jsonb_typeof(installment_terms_snapshot)='object');

update shorts_mvp.billing_orders o
set provider_auth_code=coalesce(
      o.provider_auth_code,
      nullif(e.event_summary->>'authCode','')
    ),
    provider_transaction_day=coalesce(
      o.provider_transaction_day,
      case
        when coalesce(e.event_summary->>'transactionDay','') ~ '^[0-9]{8}$'
        then to_date(e.event_summary->>'transactionDay','YYYYMMDD')
        else null
      end
    )
from shorts_mvp.billing_payment_events e
where e.billing_order_id=o.id
  and e.transaction_type='pay'
  and (
    o.provider_auth_code is null
    or o.provider_transaction_day is null
  );

alter table shorts_mvp.usage_grants
  add column if not exists credited_seconds integer,
  add column if not exists carried_seconds integer;
update shorts_mvp.usage_grants
set credited_seconds=coalesce(credited_seconds,total_seconds),
    carried_seconds=coalesce(carried_seconds,0)
where credited_seconds is null or carried_seconds is null;
alter table shorts_mvp.usage_grants
  alter column credited_seconds set not null,
  alter column carried_seconds set not null,
  alter column credited_seconds set default 0,
  alter column carried_seconds set default 0;
alter table shorts_mvp.usage_grants
  drop constraint if exists usage_grants_credit_components_check;
alter table shorts_mvp.usage_grants
  add constraint usage_grants_credit_components_check
    check (
      credited_seconds >= 0
      and carried_seconds >= 0
      and credited_seconds + carried_seconds = total_seconds
    );

create table if not exists shorts_mvp.subscription_upgrade_refunds (
  id uuid primary key default gen_random_uuid(),
  upgrade_order_id uuid not null unique
    references shorts_mvp.billing_orders(id) on delete restrict,
  source_order_id uuid not null
    references shorts_mvp.billing_orders(id) on delete restrict,
  user_id uuid not null references shorts_mvp.app_users(id) on delete restrict,
  source_plan_code text not null references shorts_mvp.plans(code) on delete restrict,
  target_plan_code text not null references shorts_mvp.plans(code) on delete restrict,
  target_billing_cycle text not null check (target_billing_cycle in ('monthly','yearly')),
  source_provider_transaction_id text not null,
  source_transaction_day date,
  source_approved_at timestamptz,
  source_auth_code text,
  source_amount_krw integer not null check (source_amount_krw > 0),
  refund_amount_krw integer not null check (refund_amount_krw > 0),
  period_start timestamptz not null,
  period_end timestamptz not null,
  total_period_days integer not null check (total_period_days > 0),
  unused_period_days integer not null check (
    unused_period_days > 0 and unused_period_days <= total_period_days
  ),
  card_issuer text,
  card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  status text not null default 'pending'
    check (status in ('pending','submitted','completed','manual_review')),
  submitted_by_user_id uuid references shorts_mvp.app_users(id) on delete restrict,
  submitted_at timestamptz,
  completed_by_user_id uuid references shorts_mvp.app_users(id) on delete restrict,
  completed_at timestamptz,
  provider_refund_transaction_id text unique,
  provider_reference text,
  admin_note text not null default '' check (char_length(admin_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end > period_start),
  check (refund_amount_krw <= source_amount_krw),
  check (
    (status='submitted' and submitted_at is not null and submitted_by_user_id is not null)
    or status <> 'submitted'
  ),
  check (
    (status='completed' and completed_at is not null)
    or status <> 'completed'
  )
);
create index if not exists subscription_upgrade_refunds_status_idx
  on shorts_mvp.subscription_upgrade_refunds (status,created_at);
create index if not exists subscription_upgrade_refunds_source_order_idx
  on shorts_mvp.subscription_upgrade_refunds (source_order_id,status);
create index if not exists subscription_upgrade_refunds_user_idx
  on shorts_mvp.subscription_upgrade_refunds (user_id,created_at desc);

alter table shorts_mvp.installment_campaigns enable row level security;
alter table shorts_mvp.installment_campaign_terms enable row level security;
alter table shorts_mvp.payment_provider_installment_capabilities enable row level security;
alter table shorts_mvp.subscription_upgrade_refunds enable row level security;
revoke all on shorts_mvp.installment_campaigns from anon, authenticated;
revoke all on shorts_mvp.installment_campaign_terms from anon, authenticated;
revoke all on shorts_mvp.payment_provider_installment_capabilities from anon, authenticated;
revoke all on shorts_mvp.subscription_upgrade_refunds from anon, authenticated;
grant all on shorts_mvp.installment_campaigns to service_role;
grant all on shorts_mvp.installment_campaign_terms to service_role;
grant all on shorts_mvp.payment_provider_installment_capabilities to service_role;
grant all on shorts_mvp.subscription_upgrade_refunds to service_role;

drop trigger if exists installment_campaigns_set_updated_at
  on shorts_mvp.installment_campaigns;
create trigger installment_campaigns_set_updated_at
before update on shorts_mvp.installment_campaigns
for each row execute function shorts_mvp.set_updated_at();
drop trigger if exists installment_campaign_terms_set_updated_at
  on shorts_mvp.installment_campaign_terms;
create trigger installment_campaign_terms_set_updated_at
before update on shorts_mvp.installment_campaign_terms
for each row execute function shorts_mvp.set_updated_at();
drop trigger if exists payment_provider_installment_capabilities_set_updated_at
  on shorts_mvp.payment_provider_installment_capabilities;
create trigger payment_provider_installment_capabilities_set_updated_at
before update on shorts_mvp.payment_provider_installment_capabilities
for each row execute function shorts_mvp.set_updated_at();
drop trigger if exists subscription_upgrade_refunds_set_updated_at
  on shorts_mvp.subscription_upgrade_refunds;
create trigger subscription_upgrade_refunds_set_updated_at
before update on shorts_mvp.subscription_upgrade_refunds
for each row execute function shorts_mvp.set_updated_at();

insert into shorts_mvp.payment_provider_installment_capabilities (
  provider,installment_months,enabled,verified_at,note
)
select 'thepayone',months,true,now(),'2025 더페이원 통합 API 매뉴얼에 기재된 할부개월'
from unnest(array[2,3,4,5,6,7,8,9,10,11,12,24,36]) as months
on conflict (provider,installment_months) do nothing;

with campaign as (
  insert into shorts_mvp.installment_campaigns (
    name,effective_from,effective_to,status,default_min_amount_krw,
    notice,published_at
  )
  select
    '2026년 7월 신용카드 할부 혜택',
    date '2026-07-01',
    date '2026-07-31',
    'published',
    50000,
    '신용카드 D·K 공통. 별도 신청 없이 이용 가능하며 카드사·상품·회원 정책에 따라 실제 적용 조건이 달라질 수 있습니다.',
    now()
  where not exists (
    select 1 from shorts_mvp.installment_campaigns
    where effective_from=date '2026-07-01'
      and effective_to=date '2026-07-31'
      and name='2026년 7월 신용카드 할부 혜택'
  )
  returning id
), campaign_id as (
  select id from campaign
  union all
  select id from shorts_mvp.installment_campaigns
  where effective_from=date '2026-07-01'
    and effective_to=date '2026-07-31'
    and name='2026년 7월 신용카드 할부 혜택'
  limit 1
), free_terms(issuer_code,issuer_name,months,min_amount,display_order) as (
  values
    ('bc','BC카드',array[2,3,4,5],50000,10),
    ('woori','우리카드',array[2,3,4,5],50000,20),
    ('hana','하나카드',array[2,3,4,5],50000,30),
    ('lotte','롯데카드',array[2,3],50000,40),
    ('hyundai','현대카드',array[2,3],10000,50),
    ('samsung','삼성카드',array[2,3],50000,60),
    ('shinhan','신한카드',array[2,3],50000,70),
    ('kb','국민카드',array[2,3],50000,80),
    ('nh','농협카드',array[2,3,4,5,6],50000,90)
)
insert into shorts_mvp.installment_campaign_terms (
  campaign_id,issuer_code,issuer_name,benefit_type,installment_months,
  customer_paid_installments,min_amount_krw,display_order
)
select c.id,t.issuer_code,t.issuer_name,'interest_free',m,null,t.min_amount,t.display_order
from campaign_id c
cross join free_terms t
cross join lateral unnest(t.months) as m
on conflict (campaign_id,issuer_code,benefit_type,installment_months) do nothing;

with campaign_id as (
  select id from shorts_mvp.installment_campaigns
  where effective_from=date '2026-07-01'
    and effective_to=date '2026-07-31'
    and name='2026년 7월 신용카드 할부 혜택'
  limit 1
), partial_terms(
  issuer_code,issuer_name,months,paid_installments,display_order
) as (
  values
    ('kb','국민카드',array[6,10,12,18],array[3,5,5,7],10),
    ('shinhan','신한카드',array[7,9,11],array[3,4,5],20),
    ('samsung','삼성카드',array[7,11,23],array[3,5,10],30),
    ('bc','BC카드',array[6,10,12],array[3,4,5],40),
    ('hyundai','현대카드',array[8,10,12],array[4,5,6],50),
    ('nh','농협카드',array[7,8,9,10,12,18,24],array[3,3,3,3,4,5,6],60),
    ('hana','하나카드',array[6,10,12,18],array[3,4,5,8],70),
    ('woori','우리카드',array[10,12],array[4,5],80)
)
insert into shorts_mvp.installment_campaign_terms (
  campaign_id,issuer_code,issuer_name,benefit_type,installment_months,
  customer_paid_installments,min_amount_krw,display_order
)
select
  c.id,t.issuer_code,t.issuer_name,'partial_interest_free',
  t.months[s.i],t.paid_installments[s.i],50000,t.display_order
from campaign_id c
cross join partial_terms t
cross join lateral generate_subscripts(t.months,1) s(i)
on conflict (campaign_id,issuer_code,benefit_type,installment_months) do nothing;

commit;
