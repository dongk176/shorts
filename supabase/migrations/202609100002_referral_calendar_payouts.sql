begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table shorts_mvp.referral_payouts
  add column if not exists settlement_month date,
  add column if not exists scheduled_payment_date date,
  add column if not exists settlement_snapshot jsonb;

-- Existing cash records are preserved. The new calendar flow is additive;
-- historical arbitrary-period payouts must be reconciled before opting in.
do $$ begin
  if exists (
    select 1 from shorts_mvp.referral_payouts
    where status in ('draft','paid') and (
      period_start<>date_trunc('month',period_start)::date
      or period_end<>(date_trunc('month',period_start)+interval '1 month - 1 day')::date
    )
  ) then
    raise exception 'Reconcile legacy non-monthly referral payouts before calendar rollout';
  end if;
end $$;

update shorts_mvp.referral_payouts
set settlement_month=period_start,
    scheduled_payment_date=(period_start+interval '1 month 9 days')::date
where settlement_month is null
  and period_start=date_trunc('month',period_start)::date
  and period_end=(period_start+interval '1 month - 1 day')::date;

alter table shorts_mvp.referral_payouts
  add constraint referral_payouts_calendar_period_check check (
    settlement_month is null or (
      settlement_month=date_trunc('month',settlement_month)::date
      and period_start=settlement_month
      and period_end=(settlement_month+interval '1 month - 1 day')::date
      and scheduled_payment_date=(settlement_month+interval '1 month 9 days')::date
    )
  );
create unique index if not exists referral_payouts_active_month_idx
  on shorts_mvp.referral_payouts(partner_id,settlement_month)
  where status in ('draft','paid') and settlement_month is not null;

commit;
