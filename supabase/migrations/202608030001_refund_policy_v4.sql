begin;

-- Never hold up live checkout traffic while waiting for a schema lock. The
-- transaction rolls back unchanged if the lock cannot be acquired quickly.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Preserve every existing order's recorded policy while assigning the new
-- policy only to orders created after this migration is applied.
alter table shorts_mvp.billing_orders
  drop constraint if exists billing_orders_refund_policy_version_check;
alter table shorts_mvp.billing_orders
  add constraint billing_orders_refund_policy_version_check
    check (refund_policy_version in (1,2,3,4));
alter table shorts_mvp.billing_orders
  alter column refund_policy_version set default 4;

alter table shorts_mvp.admin_billing_refunds
  drop constraint if exists admin_billing_refunds_refund_policy_version_check;
alter table shorts_mvp.admin_billing_refunds
  add constraint admin_billing_refunds_refund_policy_version_check
    check (refund_policy_version is null or refund_policy_version in (1,2,3,4));

comment on column shorts_mvp.billing_orders.refund_policy_version is
  '1 elapsed-day legacy; 2 monthly units; 3 first completed job; 4 AI computation and supplied digital content refund-review policy.';

commit;
