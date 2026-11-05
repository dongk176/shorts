begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';
-- Add a new contract cohort; never update existing plans or subscriptions.
do $$ declare expression text; was_validated boolean; begin
 select pg_get_expr(conbin,conrelid),convalidated into expression,was_validated
 from pg_constraint where conrelid='shorts_mvp.plans'::regclass and conname='plans_code_check';
 if expression is null then raise exception 'Missing plans_code_check'; end if;
 if position('paddle_lite_v20261105' in expression)=0 then
  alter table shorts_mvp.plans drop constraint plans_code_check;
  execute format('alter table shorts_mvp.plans add constraint plans_code_check check ((%s) or code in (''paddle_lite_v20261105'',''paddle_creator_3m_v20261105'',''paddle_creator_6m_v20261105'',''paddle_creator_12m_v20261105'',''paddle_pro_3m_v20261105'',''paddle_pro_6m_v20261105'',''paddle_pro_12m_v20261105''))%s',expression,case when was_validated then '' else ' not valid' end);
 end if;
end $$;
insert into shorts_mvp.plans(code,display_name,monthly_source_seconds,retention_days,sort_order,monthly_price_krw,yearly_price_krw,max_active_jobs,is_active,prepaid_months)
select code || '_v20261105',display_name,monthly_source_seconds,retention_days,sort_order+200,monthly_price_krw,yearly_price_krw,max_active_jobs,false,prepaid_months
from shorts_mvp.plans where code in ('paddle_lite','paddle_creator_3m','paddle_creator_6m','paddle_creator_12m','paddle_pro_3m','paddle_pro_6m','paddle_pro_12m')
on conflict (code) do nothing;
commit;
