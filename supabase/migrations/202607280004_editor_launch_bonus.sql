begin;

-- 2026-07-28 editor launch campaign.
--
-- Eligibility is intentionally frozen at 15:00 KST:
--   * a successful paid subscription/package order was approved before cutoff;
--   * the paid entitlement covered the cutoff and is still active when applied;
--   * free, trialing, past-due, complimentary, and cutoff-or-later purchases are excluded.
--
-- Each independently active subscription/package receives exactly one copy of
-- that plan's monthly included source-processing allowance.
create unique index if not exists usage_grants_editor_launch_bonus_subscription_idx
  on shorts_mvp.usage_grants (subscription_id,product_code)
  where subscription_id is not null
    and product_code='editor_launch_bonus_20260728';

with eligible_subscriptions as (
  select
    s.id as subscription_id,
    s.user_id,
    p.monthly_source_seconds
  from shorts_mvp.user_subscriptions s
  join shorts_mvp.plans p on p.code=s.plan_code
  where s.status='active'
    and s.plan_code<>'free'
    and p.monthly_source_seconds>0
    and s.current_period_start<=timestamptz '2026-07-28 15:00:00+09'
    and s.current_period_end>timestamptz '2026-07-28 15:00:00+09'
    and exists (
      select 1
      from shorts_mvp.billing_orders o
      where o.subscription_id=s.id
        and o.status='succeeded'
        and o.amount_krw>0
        and o.approved_at<timestamptz '2026-07-28 15:00:00+09'
        and o.kind in (
          'subscription_initial',
          'subscription_renewal',
          'subscription_change',
          'annual_renewal'
        )
    )
)
insert into shorts_mvp.usage_grants (
  user_id,subscription_id,billing_order_id,kind,product_code,
  total_seconds,credited_seconds,carried_seconds,
  valid_from,expires_at,status
)
select
  e.user_id,e.subscription_id,null,'addon','editor_launch_bonus_20260728',
  e.monthly_source_seconds,e.monthly_source_seconds,0,
  timestamptz '2026-07-28 15:00:00+09',
  timestamptz '2026-10-26 15:00:00+09',
  'active'
from eligible_subscriptions e
on conflict (subscription_id,product_code)
  where subscription_id is not null
    and product_code='editor_launch_bonus_20260728'
do nothing;

create table if not exists shorts_mvp.member_campaign_announcements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  campaign_code text not null,
  granted_seconds integer not null check (granted_seconds>0),
  valid_until timestamptz not null,
  presented_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id,campaign_code)
);

create index if not exists member_campaign_announcements_pending_idx
  on shorts_mvp.member_campaign_announcements (campaign_code,user_id)
  where presented_at is null;

insert into shorts_mvp.member_campaign_announcements (
  user_id,campaign_code,granted_seconds,valid_until
)
select
  g.user_id,
  'editor_launch_20260728',
  sum(g.total_seconds)::integer,
  max(g.expires_at)
from shorts_mvp.usage_grants g
where g.product_code='editor_launch_bonus_20260728'
  and g.status='active'
group by g.user_id
on conflict (user_id,campaign_code) do nothing;

alter table shorts_mvp.member_campaign_announcements enable row level security;
revoke all on table shorts_mvp.member_campaign_announcements from anon, authenticated;
grant all on table shorts_mvp.member_campaign_announcements to service_role;

comment on table shorts_mvp.member_campaign_announcements is
  'Server-owned, account-wide one-time campaign announcement eligibility and presentation audit.';
comment on column shorts_mvp.member_campaign_announcements.presented_at is
  'Set atomically before the one-time announcement payload is returned to the eligible member.';

commit;
