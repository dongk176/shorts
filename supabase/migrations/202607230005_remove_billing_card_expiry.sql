begin;

alter table shorts_mvp.billing_payment_methods
  drop constraint if exists billing_payment_methods_card_expiry_check,
  drop column if exists card_expiry_year,
  drop column if exists card_expiry_month;

commit;
