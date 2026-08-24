begin;

alter table shorts_mvp.billing_payment_methods
  add column if not exists payer_tel_ciphertext text,
  add column if not exists payer_tel_iv text,
  add column if not exists payer_tel_tag text;

alter table shorts_mvp.billing_payment_methods
  drop constraint if exists billing_payment_methods_payer_tel_encryption_check;
alter table shorts_mvp.billing_payment_methods
  add constraint billing_payment_methods_payer_tel_encryption_check check (
    (payer_tel_ciphertext is null and payer_tel_iv is null and payer_tel_tag is null)
    or
    (payer_tel_ciphertext is not null and payer_tel_iv is not null and payer_tel_tag is not null)
  );

alter table shorts_mvp.billing_orders
  add column if not exists proration_credit_krw integer not null default 0,
  add column if not exists proration_refund_track_id text,
  add column if not exists proration_refund_transaction_id text,
  add column if not exists proration_refund_status text not null default 'none';

alter table shorts_mvp.billing_orders
  drop constraint if exists billing_orders_proration_credit_check,
  drop constraint if exists billing_orders_proration_refund_status_check;
alter table shorts_mvp.billing_orders
  add constraint billing_orders_proration_credit_check
    check (proration_credit_krw >= 0 and proration_credit_krw <= amount_krw),
  add constraint billing_orders_proration_refund_status_check
    check (proration_refund_status in ('none','pending','succeeded','failed','manual_review'));

create unique index if not exists billing_orders_proration_refund_track_idx
  on shorts_mvp.billing_orders (provider,proration_refund_track_id)
  where proration_refund_track_id is not null;
create unique index if not exists billing_orders_proration_refund_transaction_idx
  on shorts_mvp.billing_orders (provider,proration_refund_transaction_id)
  where proration_refund_transaction_id is not null;

commit;
