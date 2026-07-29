begin;

create table if not exists shorts_mvp.managed_login_accounts (
  id uuid primary key default gen_random_uuid(),
  create_request_id uuid not null unique,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  app_user_id uuid not null unique references shorts_mvp.app_users(id) on delete cascade,
  login_id text not null unique check (
    login_id = lower(login_id)
    and login_id ~ '^[a-z][a-z0-9._-]{2,31}$'
  ),
  auth_email text not null unique check (char_length(auth_email) between 6 and 320),
  is_active boolean not null default true,
  popular_filter_enabled boolean not null default false,
  last_login_at timestamptz,
  last_password_reset_at timestamptz,
  created_by_user_id uuid not null references shorts_mvp.app_users(id) on delete restrict,
  updated_by_user_id uuid not null references shorts_mvp.app_users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists managed_login_accounts_status_created_idx
  on shorts_mvp.managed_login_accounts (is_active,created_at desc);

create table if not exists shorts_mvp.managed_login_attempts (
  id uuid primary key default gen_random_uuid(),
  identifier_hash text not null check (char_length(identifier_hash)=64),
  network_hash text not null check (char_length(network_hash)=64),
  succeeded boolean not null,
  failure_code text check (
    failure_code is null or char_length(failure_code) between 2 and 50
  ),
  occurred_at timestamptz not null default clock_timestamp()
);

create index if not exists managed_login_attempts_identifier_time_idx
  on shorts_mvp.managed_login_attempts (identifier_hash,occurred_at desc);
create index if not exists managed_login_attempts_network_time_idx
  on shorts_mvp.managed_login_attempts (network_hash,occurred_at desc);

alter table shorts_mvp.managed_login_accounts enable row level security;
alter table shorts_mvp.managed_login_attempts enable row level security;
revoke all on shorts_mvp.managed_login_accounts from anon, authenticated;
revoke all on shorts_mvp.managed_login_attempts from anon, authenticated;
grant all on shorts_mvp.managed_login_accounts to service_role;
grant all on shorts_mvp.managed_login_attempts to service_role;

drop trigger if exists managed_login_accounts_set_updated_at
  on shorts_mvp.managed_login_accounts;
create trigger managed_login_accounts_set_updated_at
before update on shorts_mvp.managed_login_accounts
for each row execute function shorts_mvp.set_updated_at();

comment on table shorts_mvp.managed_login_accounts is
  'Administrator-issued password accounts. Password hashes remain exclusively in Supabase Auth.';
comment on column shorts_mvp.managed_login_accounts.auth_email is
  'Internal Supabase Auth identifier. Never expose this synthetic address in user-facing screens.';
comment on table shorts_mvp.managed_login_attempts is
  'Privacy-minimized password login throttling evidence; raw identifiers and IP addresses are never stored.';

commit;
