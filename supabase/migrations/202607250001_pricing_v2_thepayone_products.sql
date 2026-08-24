begin;

alter table shorts_mvp.plans
  add column if not exists prepaid_months integer not null default 12;
alter table shorts_mvp.plans
  drop constraint if exists plans_prepaid_months_check,
  drop constraint if exists plans_code_check;
alter table shorts_mvp.plans
  add constraint plans_prepaid_months_check
    check (prepaid_months between 1 and 12),
  add constraint plans_code_check
    check (code in (
      'free','plus','standard','pro',
      'easycut_pro_v2',
      'starter_3m','starter_6m','starter_12m',
      'expert_3m','expert_6m','expert_12m'
    ));

insert into shorts_mvp.plans (
  code,display_name,monthly_source_seconds,retention_days,sort_order,
  monthly_price_krw,yearly_price_krw,max_active_jobs,is_active,prepaid_months
) values
  ('easycut_pro_v2','이지컷 프로',3600,30,40,9900,0,1,true,1),
  ('starter_3m','스타터 패키지 3개월',12000,30,50,24900,74700,2,true,3),
  ('starter_6m','스타터 패키지 6개월',12000,30,51,19900,119400,2,true,6),
  ('starter_12m','스타터 패키지 12개월',12000,30,52,16500,198000,2,true,12),
  ('expert_3m','전문가 패키지 3개월',36000,30,60,49000,147000,3,true,3),
  ('expert_6m','전문가 패키지 6개월',36000,30,61,48000,288000,3,true,6),
  ('expert_12m','전문가 패키지 12개월',36000,30,62,36000,432000,3,true,12)
on conflict (code) do update set
  display_name=excluded.display_name,
  monthly_source_seconds=excluded.monthly_source_seconds,
  retention_days=excluded.retention_days,
  sort_order=excluded.sort_order,
  monthly_price_krw=excluded.monthly_price_krw,
  yearly_price_krw=excluded.yearly_price_krw,
  max_active_jobs=excluded.max_active_jobs,
  is_active=excluded.is_active,
  prepaid_months=excluded.prepaid_months,
  updated_at=now();

insert into shorts_mvp.addon_products (
  code,display_name,seconds,price_krw,validity_days,sort_order,is_active
) values
  ('earlybird_300','얼리버드 추가 300분',18000,48000,90,110,true),
  ('earlybird_600','얼리버드 추가 600분',36000,84000,90,120,true),
  ('earlybird_1000','얼리버드 추가 1,000분',60000,120000,90,130,true)
on conflict (code) do update set
  display_name=excluded.display_name,
  seconds=excluded.seconds,
  price_krw=excluded.price_krw,
  validity_days=excluded.validity_days,
  sort_order=excluded.sort_order,
  is_active=excluded.is_active,
  updated_at=now();

create unique index if not exists billing_orders_one_earlybird_product_per_user_idx
  on shorts_mvp.billing_orders (user_id,product_code)
  where kind='addon'
    and status in ('pending','processing','succeeded','manual_review')
    and product_code in ('earlybird_300','earlybird_600','earlybird_1000');

commit;
