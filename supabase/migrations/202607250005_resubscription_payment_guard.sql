begin;

create unique index if not exists billing_orders_one_resubscription_in_flight_idx
  on shorts_mvp.billing_orders (subscription_id)
  where kind='subscription_change'
    and product_code='easycut_pro_v2'
    and status in ('pending','processing');

commit;
