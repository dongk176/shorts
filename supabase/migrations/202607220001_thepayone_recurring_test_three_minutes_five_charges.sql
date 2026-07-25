begin;

-- Preserve completed historical 1-minute/3-charge test runs while allowing the
-- current ThePayOne scenario to run five charges at three-minute intervals.
alter table shorts_mvp.payment_test_recurring_runs
  drop constraint if exists payment_test_recurring_runs_interval_seconds_check,
  drop constraint if exists payment_test_recurring_runs_target_charge_count_check,
  drop constraint if exists payment_test_recurring_runs_succeeded_charge_count_check;

alter table shorts_mvp.payment_test_recurring_runs
  alter column interval_seconds set default 180,
  alter column target_charge_count set default 5;

alter table shorts_mvp.payment_test_recurring_runs
  add constraint payment_test_recurring_runs_interval_seconds_check
    check (interval_seconds in (60, 180, 300)),
  add constraint payment_test_recurring_runs_target_charge_count_check
    check (target_charge_count in (3, 5)),
  add constraint payment_test_recurring_runs_succeeded_charge_count_check
    check (succeeded_charge_count between 0 and target_charge_count);

alter table shorts_mvp.payment_test_charge_attempts
  drop constraint if exists payment_test_charge_attempts_sequence_no_check;

alter table shorts_mvp.payment_test_charge_attempts
  add constraint payment_test_charge_attempts_sequence_no_check
    check (sequence_no between 1 and 5);

commit;
