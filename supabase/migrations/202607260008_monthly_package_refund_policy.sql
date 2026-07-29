begin;

-- Orders that already exist keep the daily-proration policy shown at checkout.
-- New orders receive policy 2, which treats prepaid packages as monthly units.
alter table shorts_mvp.billing_orders
  add column if not exists refund_policy_version smallint default 1;

update shorts_mvp.billing_orders
set refund_policy_version=1
where refund_policy_version is null;

alter table shorts_mvp.billing_orders
  alter column refund_policy_version set not null;

-- Policy 3 is introduced by a later migration. On a full replay, retain its
-- default instead of temporarily moving new orders back to policy 2.
do $migration$
begin
  if to_regclass('shorts_mvp.admin_refund_cases') is null then
    alter table shorts_mvp.billing_orders
      alter column refund_policy_version set default 2;
  end if;
end
$migration$;

alter table shorts_mvp.billing_orders
  drop constraint if exists billing_orders_refund_policy_version_check;
alter table shorts_mvp.billing_orders
  add constraint billing_orders_refund_policy_version_check
    check (refund_policy_version in (1,2,3));

comment on column shorts_mvp.billing_orders.refund_policy_version is
  '1 uses elapsed-day proration; 2 treats prepaid packages as divisible monthly service units.';

alter table shorts_mvp.admin_billing_refunds
  add column if not exists refund_policy_version smallint,
  add column if not exists policy_quote jsonb,
  add column if not exists entitlement_action_mode text not null default 'none',
  add column if not exists entitlement_effective_at timestamptz;

alter table shorts_mvp.admin_billing_refunds
  drop constraint if exists admin_billing_refunds_refund_policy_version_check,
  drop constraint if exists admin_billing_refunds_entitlement_action_mode_check,
  drop constraint if exists admin_billing_refunds_entitlement_action_status_check;
alter table shorts_mvp.admin_billing_refunds
  add constraint admin_billing_refunds_refund_policy_version_check
    check (refund_policy_version is null or refund_policy_version in (1,2,3)),
  add constraint admin_billing_refunds_entitlement_action_mode_check
    check (entitlement_action_mode in ('none','revoke_now','end_at')),
  add constraint admin_billing_refunds_entitlement_action_status_check
    check (
      entitlement_action_status in (
        'not_required','scheduled_end','revoked','manual_review'
      )
    );

comment on column shorts_mvp.admin_billing_refunds.policy_quote is
  'Immutable refund-policy calculation snapshot used for provider retries and audit.';
comment on column shorts_mvp.admin_billing_refunds.entitlement_action_mode is
  'Entitlement mutation to apply only after the provider refund succeeds.';
comment on column shorts_mvp.admin_billing_refunds.entitlement_effective_at is
  'Immediate or month-end package entitlement cutoff paired with the refund.';

commit;
