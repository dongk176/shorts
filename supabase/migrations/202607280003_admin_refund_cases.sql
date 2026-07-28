begin;

-- Refund policy 3 replaces elapsed-day and elapsed-month proration with a
-- single rule: deduct one paid month only after the first order-funded job
-- completes. Existing orders are versioned explicitly so checkout, admin, and
-- recorded refund calculations all use the same rule.
alter table shorts_mvp.billing_orders
  drop constraint if exists billing_orders_refund_policy_version_check;
alter table shorts_mvp.billing_orders
  add constraint billing_orders_refund_policy_version_check
    check (refund_policy_version in (1,2,3));
update shorts_mvp.billing_orders
set refund_policy_version=3
where refund_policy_version<>3;
alter table shorts_mvp.billing_orders
  alter column refund_policy_version set default 3;

alter table shorts_mvp.admin_billing_refunds
  drop constraint if exists admin_billing_refunds_refund_policy_version_check;
alter table shorts_mvp.admin_billing_refunds
  add constraint admin_billing_refunds_refund_policy_version_check
    check (refund_policy_version is null or refund_policy_version in (1,2,3));

comment on column shorts_mvp.billing_orders.refund_policy_version is
  '1 elapsed-day legacy; 2 elapsed monthly units; 3 deducts one paid month only after the first order-funded job completes.';

create table if not exists shorts_mvp.admin_refund_cases (
  id uuid primary key default gen_random_uuid(),
  billing_order_id uuid not null references shorts_mvp.billing_orders(id) on delete restrict,
  user_id uuid not null references shorts_mvp.app_users(id) on delete restrict,
  inquiry_id uuid references shorts_mvp.customer_inquiries(id) on delete set null,
  actual_refund_id uuid unique references shorts_mvp.admin_billing_refunds(id) on delete set null,
  created_by_user_id uuid not null references shorts_mvp.app_users(id) on delete restrict,
  assigned_to_user_id uuid references shorts_mvp.app_users(id) on delete set null,
  status text not null default 'unprocessed' check (
    status in ('unprocessed','in_progress','completed','manual_review','closed')
  ),
  reason_code text not null check (
    reason_code in (
      'customer_early_termination','statutory_withdrawal_unused',
      'company_fault','duplicate_or_mistaken_payment','goodwill'
    )
  ),
  reason_detail text not null check (char_length(reason_detail) between 2 and 1000),
  first_job_completed boolean not null default false,
  first_completed_job_id uuid references shorts_mvp.video_jobs(id) on delete set null,
  first_completed_job_at timestamptz,
  prepaid_months integer not null check (prepaid_months between 1 and 120),
  monthly_deduction_krw integer not null default 0 check (monthly_deduction_krw >= 0),
  calculated_refund_krw integer not null default 0 check (calculated_refund_krw >= 0),
  planned_refund_krw integer not null default 0 check (planned_refund_krw >= 0),
  refund_action text not null default 'policy_refund' check (
    refund_action in ('policy_refund','manual_amount','none')
  ),
  payment_status text not null default 'not_started' check (
    payment_status in ('not_started','submitted','completed','failed','manual_review')
  ),
  billing_action text not null default 'none' check (
    billing_action in ('none','pause_now_keep_until_period_end')
  ),
  entitlement_action text not null default 'none' check (
    entitlement_action in ('none','revoke_now','end_at_current_period')
  ),
  entitlement_effective_at timestamptz,
  service_action_status text not null default 'not_requested' check (
    service_action_status in (
      'not_requested','processing','succeeded','failed','manual_review'
    )
  ),
  provider_reference text check (
    provider_reference is null or char_length(provider_reference) <= 200
  ),
  admin_note text check (admin_note is null or char_length(admin_note) <= 2000),
  completed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (first_job_completed and first_completed_job_id is not null and first_completed_job_at is not null)
    or (not first_job_completed)
  ),
  check (
    (status='completed' and completed_at is not null)
    or status<>'completed'
  ),
  check (
    (status='closed' and closed_at is not null)
    or status<>'closed'
  )
);

create index if not exists admin_refund_cases_status_created_idx
  on shorts_mvp.admin_refund_cases (status,created_at desc);
create index if not exists admin_refund_cases_user_created_idx
  on shorts_mvp.admin_refund_cases (user_id,created_at desc);
create index if not exists admin_refund_cases_order_created_idx
  on shorts_mvp.admin_refund_cases (billing_order_id,created_at desc);

create table if not exists shorts_mvp.admin_refund_case_events (
  id bigint generated always as identity primary key,
  refund_case_id uuid not null references shorts_mvp.admin_refund_cases(id) on delete cascade,
  actor_user_id uuid not null references shorts_mvp.app_users(id) on delete restrict,
  event_type text not null check (char_length(event_type) between 2 and 100),
  from_status text,
  to_status text,
  note text check (note is null or char_length(note) <= 2000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_refund_case_events_case_created_idx
  on shorts_mvp.admin_refund_case_events (refund_case_id,created_at desc);

alter table shorts_mvp.admin_refund_cases enable row level security;
alter table shorts_mvp.admin_refund_case_events enable row level security;
revoke all on shorts_mvp.admin_refund_cases from anon, authenticated;
revoke all on shorts_mvp.admin_refund_case_events from anon, authenticated;
grant all on shorts_mvp.admin_refund_cases to service_role;
grant all on shorts_mvp.admin_refund_case_events to service_role;

drop trigger if exists admin_refund_cases_set_updated_at
  on shorts_mvp.admin_refund_cases;
create trigger admin_refund_cases_set_updated_at
before update on shorts_mvp.admin_refund_cases
for each row execute function shorts_mvp.set_updated_at();

-- Preserve the existing real-card refund history in the new operational queue.
insert into shorts_mvp.admin_refund_cases (
  billing_order_id,user_id,actual_refund_id,created_by_user_id,assigned_to_user_id,
  status,reason_code,reason_detail,first_job_completed,first_completed_job_id,
  first_completed_job_at,prepaid_months,monthly_deduction_krw,
  calculated_refund_krw,planned_refund_krw,refund_action,payment_status,
  billing_action,entitlement_action,entitlement_effective_at,
  service_action_status,provider_reference,admin_note,completed_at,created_at,updated_at
)
select
  r.billing_order_id,o.user_id,r.id,r.requested_by_user_id,r.requested_by_user_id,
  case r.status
    when 'succeeded' then 'completed'
    when 'failed' then 'manual_review'
    when 'manual_review' then 'manual_review'
    else 'in_progress'
  end,
  'goodwill',r.reason,
  first_job.id is not null,first_job.id,first_job.completed_at,
  case when o.billing_cycle='yearly' then coalesce(p.prepaid_months,12) else 1 end,
  case when first_job.id is null then 0 else floor(
    o.amount_krw::numeric
    / case when o.billing_cycle='yearly' then coalesce(p.prepaid_months,12) else 1 end
  )::integer end,
  r.amount_krw,r.amount_krw,
  case when r.amount_krw=o.amount_krw then 'policy_refund' else 'manual_amount' end,
  case r.status
    when 'succeeded' then 'completed'
    when 'failed' then 'failed'
    when 'manual_review' then 'manual_review'
    when 'processing' then 'submitted'
    else 'not_started'
  end,
  'none',
  case r.entitlement_action_mode
    when 'revoke_now' then 'revoke_now'
    when 'end_at' then 'end_at_current_period'
    else 'none'
  end,
  r.entitlement_effective_at,
  case r.entitlement_action_status
    when 'revoked' then 'succeeded'
    when 'scheduled_end' then 'succeeded'
    when 'manual_review' then 'manual_review'
    else 'not_requested'
  end,
  r.provider_refund_transaction_id,r.failure_message,
  case when r.status='succeeded' then coalesce(r.processed_at,r.updated_at) else null end,
  r.requested_at,r.updated_at
from shorts_mvp.admin_billing_refunds r
join shorts_mvp.billing_orders o on o.id=r.billing_order_id
left join shorts_mvp.plans p on p.code=o.product_code
left join lateral (
  select j.id,j.completed_at
  from shorts_mvp.usage_grants g
  join shorts_mvp.usage_grant_allocations a
    on a.grant_id=g.id and a.status='consumed'
  join shorts_mvp.usage_reservations ur
    on ur.id=a.reservation_id and ur.status='consumed'
  join shorts_mvp.video_jobs j
    on j.id=ur.job_id and j.status='completed' and j.completed_at is not null
  where g.billing_order_id=o.id
  order by j.completed_at,j.created_at,j.id
  limit 1
) first_job on true
where not exists (
  select 1
  from shorts_mvp.admin_refund_cases existing
  where existing.actual_refund_id=r.id
)
on conflict (actual_refund_id) do nothing;

insert into shorts_mvp.admin_refund_case_events (
  refund_case_id,actor_user_id,event_type,to_status,note,metadata,created_at
)
select
  c.id,c.created_by_user_id,'refund_case.backfilled',c.status,
  '기존 실제 환불 기록에서 이관',
  jsonb_build_object('actualRefundId',c.actual_refund_id),
  c.created_at
from shorts_mvp.admin_refund_cases c
where c.actual_refund_id is not null
  and not exists (
    select 1 from shorts_mvp.admin_refund_case_events e
    where e.refund_case_id=c.id and e.event_type='refund_case.backfilled'
  );

commit;
