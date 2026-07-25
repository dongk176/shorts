begin;

alter table shorts_mvp.payment_test_recurring_runs
  drop constraint if exists payment_test_recurring_runs_interval_seconds_check;

alter table shorts_mvp.payment_test_recurring_runs
  alter column interval_seconds set default 60;

alter table shorts_mvp.payment_test_recurring_runs
  add constraint payment_test_recurring_runs_interval_seconds_check
  -- A later migration introduced 180-second runs. Keep that historical value
  -- valid when this idempotent migration chain is replayed.
  check (interval_seconds in (60, 180, 300));

commit;
