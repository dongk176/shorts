begin;

set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- The column remains for backward compatibility, but paid feature access is
-- now derived from an active administrator-issued account in application code.
alter table shorts_mvp.managed_login_accounts
  alter column popular_filter_enabled set default true;

update shorts_mvp.managed_login_accounts
set popular_filter_enabled=true,
  updated_at=clock_timestamp()
where popular_filter_enabled=false;

comment on column shorts_mvp.managed_login_accounts.popular_filter_enabled is
  'Legacy compatibility flag. Active administrator-issued accounts always receive paid feature access.';

commit;
