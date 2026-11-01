begin;
set local lock_timeout = '3s';

-- Add one versioned product; never update existing contracts or legacy prices.
do $$
declare item record; expression text; validated boolean;
begin
  for item in select * from (values
    ('plans','plans_code_check','code'),
    ('billing_toss_checkout_intents','billing_toss_checkout_intents_target_plan_code_check','target_plan_code')
  ) as entries(table_name,constraint_name,column_name) loop
    select pg_get_expr(conbin,conrelid),convalidated into expression,validated
    from pg_constraint where conrelid=format('shorts_mvp.%I',item.table_name)::regclass
      and conname=item.constraint_name and contype='c';
    if expression is null then raise exception 'Missing catalog constraint: %',item.constraint_name; end if;
    if position('toss_easycut_pro_1m_20261101' in expression)=0 then
      execute format('alter table shorts_mvp.%I drop constraint %I',item.table_name,item.constraint_name);
      execute format('alter table shorts_mvp.%I add constraint %I check ((%s) or %I=%L)%s',
        item.table_name,item.constraint_name,expression,item.column_name,'toss_easycut_pro_1m_20261101',
        case when validated then '' else ' not valid' end);
    end if;
  end loop;
end $$;

insert into shorts_mvp.plans (
  code,display_name,monthly_source_seconds,retention_days,sort_order,
  monthly_price_krw,yearly_price_krw,max_active_jobs,is_active,prepaid_months
) values ('toss_easycut_pro_1m_20261101','이지컷 프로 1개월',3600,30,143,19900,19900,1,false,1)
on conflict (code) do nothing;

do $$ begin
  if not exists(select 1 from shorts_mvp.plans where code='toss_easycut_pro_1m'
    and monthly_price_krw=9900 and yearly_price_krw=9900) then
    raise exception 'Legacy Pro renewal price does not match the approved baseline';
  end if;
  if not exists(select 1 from shorts_mvp.plans where code='toss_easycut_pro_1m_20261101'
    and monthly_price_krw=19900 and yearly_price_krw=19900 and monthly_source_seconds=3600
    and max_active_jobs=1 and prepaid_months=1 and retention_days=30 and is_active=false) then
    raise exception 'New Pro product does not match the approved catalog';
  end if;
end $$;
commit;
