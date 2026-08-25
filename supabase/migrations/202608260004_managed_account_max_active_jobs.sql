begin;

set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table shorts_mvp.managed_login_accounts
  add column if not exists max_active_jobs integer;

update shorts_mvp.managed_login_accounts
set max_active_jobs=10,
  updated_at=clock_timestamp()
where max_active_jobs is null;

alter table shorts_mvp.managed_login_accounts
  alter column max_active_jobs set default 10,
  alter column max_active_jobs set not null;

alter table shorts_mvp.managed_login_accounts
  drop constraint if exists managed_login_accounts_max_active_jobs_check;
alter table shorts_mvp.managed_login_accounts
  add constraint managed_login_accounts_max_active_jobs_check
  check (max_active_jobs between 1 and 10);

comment on column shorts_mvp.managed_login_accounts.max_active_jobs is
  'Administrator-controlled per-account concurrent job limit. Existing and new issued accounts default to 10.';

commit;
