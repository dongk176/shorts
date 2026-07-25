begin;

alter table shorts_mvp.billing_orders
  add column if not exists purchase_limit_version smallint not null default 0;

alter table shorts_mvp.billing_orders
  drop constraint if exists billing_orders_purchase_limit_version_check;

alter table shorts_mvp.billing_orders
  add constraint billing_orders_purchase_limit_version_check
    check (purchase_limit_version in (0,1));

create unique index if not exists billing_orders_one_package_product_per_user_idx
  on shorts_mvp.billing_orders (user_id,product_code)
  where purchase_limit_version=1
    and status in ('pending','processing','succeeded','manual_review')
    and product_code in (
      'starter_3m','starter_6m','starter_12m',
      'expert_3m','expert_6m','expert_12m'
    );

comment on column shorts_mvp.billing_orders.purchase_limit_version is
  '0=legacy/unrestricted order, 1=account-level one-time package purchase guard';

commit;
