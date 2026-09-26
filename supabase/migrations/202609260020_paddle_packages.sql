begin;
set local lock_timeout = '3s';
-- Widen only the plan-code boundary; preserve legacy NOT VALID constraints.
do $$ declare expression text; was_validated boolean; begin
 select pg_get_expr(conbin,conrelid),convalidated into expression,was_validated
 from pg_constraint where conrelid='shorts_mvp.plans'::regclass and conname='plans_code_check';
 if expression is null then raise exception 'Missing plans_code_check'; end if;
 if position('paddle_creator_3m' in expression)=0 then
  alter table shorts_mvp.plans drop constraint plans_code_check;
  execute format('alter table shorts_mvp.plans add constraint plans_code_check check ((%s) or code in (''paddle_creator_3m'',''paddle_creator_6m'',''paddle_creator_12m'',''paddle_pro_3m'',''paddle_pro_6m'',''paddle_pro_12m''))%s',expression,case when was_validated then '' else ' not valid' end);
 end if;
end $$;
insert into shorts_mvp.plans(code,display_name,monthly_source_seconds,retention_days,sort_order,monthly_price_krw,yearly_price_krw,max_active_jobs,is_active,prepaid_months)
values ('paddle_creator_3m','EasyCut Starter 3 months',12000,30,911,0,0,2,false,3),
 ('paddle_creator_6m','EasyCut Starter 6 months',12000,30,912,0,0,2,false,6),
 ('paddle_creator_12m','EasyCut Starter 12 months',12000,30,913,0,0,2,false,12),
 ('paddle_pro_3m','EasyCut Expert 3 months',36000,30,921,0,0,3,false,3),
 ('paddle_pro_6m','EasyCut Expert 6 months',36000,30,922,0,0,3,false,6),
 ('paddle_pro_12m','EasyCut Expert 12 months',36000,30,923,0,0,3,false,12)
on conflict (code) do nothing;
create table if not exists shorts_mvp.paddle_payment_grants (
 transaction_id text not null references shorts_mvp.paddle_payments(transaction_id),
 grant_id uuid not null unique references shorts_mvp.usage_grants(id),
 primary key(transaction_id,grant_id)
);
insert into shorts_mvp.paddle_payment_grants(transaction_id,grant_id)
 select transaction_id,grant_id from shorts_mvp.paddle_payments where grant_id is not null
 on conflict do nothing;
alter table shorts_mvp.paddle_payment_grants enable row level security;
revoke all on shorts_mvp.paddle_payment_grants from public,anon,authenticated;
grant all on shorts_mvp.paddle_payment_grants to service_role;
commit;
