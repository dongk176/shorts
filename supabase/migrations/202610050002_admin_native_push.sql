begin;

alter table shorts_mvp.admin_mobile_subscriptions
  add column if not exists transport text not null default 'web' check (transport in ('web','apns')),
  add column if not exists installation_id uuid,
  add column if not exists apns_token text,
  add column if not exists apns_environment text check (apns_environment in ('development','production'));
alter table shorts_mvp.admin_mobile_subscriptions alter column p256dh drop not null;
alter table shorts_mvp.admin_mobile_subscriptions alter column auth drop not null;
alter table shorts_mvp.admin_mobile_subscriptions add constraint admin_mobile_transport_keys_check check (
  (transport='web' and p256dh is not null and auth is not null and apns_token is null)
  or (transport='apns' and installation_id is not null and apns_token is not null and apns_token ~ '^[0-9a-f]{64,200}$'
    and apns_environment is not null and p256dh is null and auth is null)
);
create unique index admin_mobile_installation_idx on shorts_mvp.admin_mobile_subscriptions(installation_id)
  where installation_id is not null;

-- The native login has access only to the mobile administrator API. It cannot
-- authenticate billing actions, the editor, workers, or other product APIs.
create table shorts_mvp.admin_native_auth_codes (
  code_hash text primary key,
  admin_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  challenge text not null,
  expires_at timestamptz not null default now()+interval '60 seconds'
);
create table shorts_mvp.admin_native_sessions (
  token_hash text primary key,
  admin_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '30 days'
);
alter table shorts_mvp.admin_native_auth_codes enable row level security;
alter table shorts_mvp.admin_native_sessions enable row level security;
revoke all on shorts_mvp.admin_native_auth_codes,shorts_mvp.admin_native_sessions from public,anon,authenticated;
grant all on shorts_mvp.admin_native_auth_codes,shorts_mvp.admin_native_sessions to service_role;
commit;
