begin;

-- Expand the production Toss catalog without reusing or deleting any legacy
-- product code. Existing EasyCut Pro 6/12-month contracts therefore keep the
-- exact product identity and renewal price that they were sold with.
set local lock_timeout = '3s';

alter table shorts_mvp.plans
  drop constraint if exists plans_code_check_toss_3_6_12;
alter table shorts_mvp.plans
  add constraint plans_code_check_toss_3_6_12
  check (code in (
    'free','plus','standard','pro',
    'easycut_pro_v2',
    'starter_3m','starter_6m','starter_12m',
    'expert_3m','expert_6m','expert_12m',
    'toss_easycut_pro_1m','toss_easycut_pro_6m','toss_easycut_pro_12m',
    'toss_starter_1m','toss_starter_3m','toss_starter_6m','toss_starter_12m',
    'toss_expert_1m','toss_expert_3m','toss_expert_6m','toss_expert_12m'
  )) not valid;
alter table shorts_mvp.plans drop constraint if exists plans_code_check;
alter table shorts_mvp.plans
  rename constraint plans_code_check_toss_3_6_12 to plans_code_check;

insert into shorts_mvp.plans (
  code,display_name,monthly_source_seconds,retention_days,sort_order,
  monthly_price_krw,yearly_price_krw,max_active_jobs,is_active,prepaid_months
) values
  ('toss_starter_3m','스타터 패키지 3개월',12000,30,150,23655,70965,2,false,3),
  ('toss_expert_3m','전문가 패키지 3개월',36000,30,160,49000,147000,3,false,3)
on conflict (code) do update set
  display_name=excluded.display_name,
  monthly_source_seconds=excluded.monthly_source_seconds,
  retention_days=excluded.retention_days,
  monthly_price_krw=excluded.monthly_price_krw,
  yearly_price_krw=excluded.yearly_price_krw,
  max_active_jobs=excluded.max_active_jobs,
  is_active=false,
  prepaid_months=excluded.prepaid_months;

-- These codes were never part of the legacy EasyCut Pro 6-month cohort. Stop
-- rather than silently repricing if an affected Toss package contract appears
-- before this migration is applied.
do $$
begin
  if exists (
    select 1
    from shorts_mvp.user_subscriptions
    where payment_provider='toss'
      and status in ('pending','trialing','active','past_due')
      and plan_code in (
        'toss_starter_6m','toss_starter_12m',
        'toss_expert_6m','toss_expert_12m'
      )
  ) then
    raise exception 'active Toss package contract requires a versioned product migration';
  end if;
end
$$;

update shorts_mvp.plans
set display_name='스타터 패키지 6개월',monthly_price_krw=19900,
  yearly_price_krw=119400,monthly_source_seconds=12000,max_active_jobs=2,
  prepaid_months=6,is_active=false
where code='toss_starter_6m';
update shorts_mvp.plans
set display_name='스타터 패키지 12개월',monthly_price_krw=16500,
  yearly_price_krw=198000,monthly_source_seconds=12000,max_active_jobs=2,
  prepaid_months=12,is_active=false
where code='toss_starter_12m';
update shorts_mvp.plans
set display_name='전문가 패키지 6개월',monthly_price_krw=48000,
  yearly_price_krw=288000,monthly_source_seconds=36000,max_active_jobs=3,
  prepaid_months=6,is_active=false
where code='toss_expert_6m';
update shorts_mvp.plans
set display_name='전문가 패키지 12개월',monthly_price_krw=36000,
  yearly_price_krw=432000,monthly_source_seconds=36000,max_active_jobs=3,
  prepaid_months=12,is_active=false
where code='toss_expert_12m';

alter table shorts_mvp.user_subscriptions
  drop constraint if exists user_subscriptions_contract_months_check,
  drop constraint if exists user_subscriptions_scheduled_contract_months_check;
alter table shorts_mvp.user_subscriptions
  add constraint user_subscriptions_contract_months_check
  check (contract_months is null or contract_months in (1,3,6,12)) not valid,
  add constraint user_subscriptions_scheduled_contract_months_check
  check (scheduled_contract_months is null or scheduled_contract_months in (1,3,6,12)) not valid;

alter table shorts_mvp.billing_toss_checkout_intents
  drop constraint if exists billing_toss_checkout_intents_target_plan_code_check;
alter table shorts_mvp.billing_toss_checkout_intents
  add constraint billing_toss_checkout_intents_target_plan_code_check
  check (target_plan_code in (
    'toss_easycut_pro_1m','toss_easycut_pro_6m','toss_easycut_pro_12m',
    'toss_starter_1m','toss_starter_3m','toss_starter_6m','toss_starter_12m',
    'toss_expert_1m','toss_expert_3m','toss_expert_6m','toss_expert_12m'
  )) not valid;

commit;
