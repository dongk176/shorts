begin;

drop index if exists shorts_mvp.user_subscriptions_one_current_idx;

create unique index if not exists user_subscriptions_one_current_monthly_idx
  on shorts_mvp.user_subscriptions (user_id)
  where status in ('pending','trialing','active','past_due')
    and billing_cycle='monthly';

update shorts_mvp.user_subscriptions
set next_charge_at=null,
    next_retry_at=null,
    grace_ends_at=null,
    retry_count=0
where plan_code in (
    'starter_3m','starter_6m','starter_12m',
    'expert_3m','expert_6m','expert_12m'
  )
  and billing_cycle='yearly'
  and status in ('pending','trialing','active','past_due');

commit;
