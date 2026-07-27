begin;

alter table shorts_mvp.account_withdrawal_retention
  add column if not exists legal_hold_until timestamptz,
  add column if not exists legal_hold_reason text;

alter table shorts_mvp.account_withdrawal_retention
  drop constraint if exists account_withdrawal_retention_legal_hold_until_check,
  drop constraint if exists account_withdrawal_retention_legal_hold_reason_check,
  drop constraint if exists account_withdrawal_retention_legal_hold_pair_check;

alter table shorts_mvp.account_withdrawal_retention
  add constraint account_withdrawal_retention_legal_hold_until_check
    check (legal_hold_until is null or legal_hold_until >= withdrawn_at),
  add constraint account_withdrawal_retention_legal_hold_reason_check
    check (legal_hold_reason is null or char_length(legal_hold_reason) between 2 and 500),
  add constraint account_withdrawal_retention_legal_hold_pair_check
    check (
      (legal_hold_until is null and legal_hold_reason is null)
      or (legal_hold_until is not null and legal_hold_reason is not null)
    );

drop index if exists shorts_mvp.account_withdrawal_retention_due_idx;
create index account_withdrawal_retention_due_idx
  on shorts_mvp.account_withdrawal_retention (
    greatest(legal_records_until,coalesce(legal_hold_until,legal_records_until))
  );

comment on column shorts_mvp.account_withdrawal_retention.legal_hold_until is
  'Optional extension supported by a documented live dispute, investigation, litigation, or other legal basis.';
comment on column shorts_mvp.account_withdrawal_retention.legal_hold_reason is
  'Documented legal basis for retaining a withdrawn account archive beyond the ordinary deadline.';

commit;
