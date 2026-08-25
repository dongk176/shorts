begin;

alter table shorts_mvp.managed_login_accounts
  add column if not exists account_type text not null default 'personal';

alter table shorts_mvp.managed_login_accounts
  drop constraint if exists managed_login_accounts_account_type_check;

alter table shorts_mvp.managed_login_accounts
  add constraint managed_login_accounts_account_type_check
  check (account_type in ('personal','enterprise'));

comment on column shorts_mvp.managed_login_accounts.account_type is
  'Administrator-selected account category. Existing and unspecified accounts default to personal.';

commit;
