begin;

set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table shorts_mvp.managed_login_accounts
  drop constraint if exists managed_login_accounts_max_active_jobs_check;
alter table shorts_mvp.managed_login_accounts
  add constraint managed_login_accounts_max_active_jobs_check
  check (max_active_jobs between 1 and 30);

comment on column shorts_mvp.managed_login_accounts.max_active_jobs is
  'Administrator-controlled per-account concurrent job limit. Defaults to 10 and supports values from 1 through 30.';

commit;
