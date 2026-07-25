begin;

alter table shorts_mvp.billing_payment_methods
  add column if not exists card_expiry_year text,
  add column if not exists card_expiry_month text;

alter table shorts_mvp.billing_payment_methods
  drop constraint if exists billing_payment_methods_card_expiry_check;
alter table shorts_mvp.billing_payment_methods
  add constraint billing_payment_methods_card_expiry_check check (
    (card_expiry_year is null and card_expiry_month is null)
    or (
      card_expiry_year ~ '^[0-9]{2}$'
      and card_expiry_month ~ '^(0[1-9]|1[0-2])$'
    )
  );

commit;
