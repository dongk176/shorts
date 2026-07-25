begin;

alter table shorts_mvp.app_users
  add column if not exists default_payment_method_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname='app_users_default_payment_method_id_fkey'
      and conrelid='shorts_mvp.app_users'::regclass
  ) then
    alter table shorts_mvp.app_users
      add constraint app_users_default_payment_method_id_fkey
      foreign key (default_payment_method_id)
      references shorts_mvp.billing_payment_methods(id)
      on delete set null;
  end if;
end $$;

create index if not exists app_users_default_payment_method_idx
  on shorts_mvp.app_users (default_payment_method_id)
  where default_payment_method_id is not null;

with latest_successful_method as (
  select distinct on (o.user_id)
    o.user_id,
    o.payment_method_id
  from shorts_mvp.billing_orders o
  join shorts_mvp.billing_payment_methods m
    on m.id=o.payment_method_id
   and m.user_id=o.user_id
  where o.status='succeeded'
    and o.payment_method_id is not null
    and m.status not in ('disposed','manual_review','replaced','revoked')
  order by o.user_id,o.approved_at desc nulls last,o.created_at desc
)
update shorts_mvp.app_users u
set default_payment_method_id=latest.payment_method_id
from latest_successful_method latest
where latest.user_id=u.id
  and u.default_payment_method_id is null;

with latest_subscription_method as (
  select distinct on (s.user_id)
    s.user_id,
    s.payment_method_id
  from shorts_mvp.user_subscriptions s
  join shorts_mvp.billing_payment_methods m
    on m.id=s.payment_method_id
   and m.user_id=s.user_id
  where s.payment_method_id is not null
    and s.status in ('active','past_due')
    and m.status not in ('disposed','manual_review','replaced','revoked')
  order by s.user_id,s.updated_at desc,s.created_at desc
)
update shorts_mvp.app_users u
set default_payment_method_id=latest.payment_method_id
from latest_subscription_method latest
where latest.user_id=u.id
  and u.default_payment_method_id is null;

comment on column shorts_mvp.app_users.default_payment_method_id is
  'Account-wide default card; always points to the most recently used successful payment method.';

commit;
