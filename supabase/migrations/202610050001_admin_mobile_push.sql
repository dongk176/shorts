begin;

-- Additive administrator-only state. Existing billing and worker tables are untouched.
create table if not exists shorts_mvp.admin_mobile_preferences (
  admin_id uuid primary key references shorts_mvp.app_users(id) on delete cascade,
  payments boolean not null default true,
  operations boolean not null default true,
  quiet_night boolean not null default true,
  show_amount boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists shorts_mvp.admin_mobile_subscriptions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 2048),
  p256dh text not null check (char_length(p256dh) between 80 and 100),
  auth text not null check (char_length(auth) between 20 and 30),
  active boolean not null default true,
  active_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_test_at timestamptz
);
create index if not exists admin_mobile_subscriptions_admin_idx
  on shorts_mvp.admin_mobile_subscriptions(admin_id) where active;
create table if not exists shorts_mvp.admin_mobile_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  incident_key text,
  kind text not null check (kind in ('urgent','attention','payment','recovery')),
  title text not null,
  subtitle text not null,
  detail text not null,
  next_step text not null,
  impact text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  detected_at timestamptz not null default now(),
  healthy_since timestamptz,
  resolved_at timestamptz
);
create unique index if not exists admin_mobile_events_open_incident_idx
  on shorts_mvp.admin_mobile_events(incident_key) where incident_key is not null and resolved_at is null;
create index if not exists admin_mobile_events_recent_idx on shorts_mvp.admin_mobile_events(occurred_at desc);
create table if not exists shorts_mvp.admin_mobile_receipts (
  event_id uuid not null references shorts_mvp.admin_mobile_events(id) on delete cascade,
  admin_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  read_at timestamptz,
  acknowledged_at timestamptz,
  primary key(event_id,admin_id)
);
create table if not exists shorts_mvp.admin_mobile_deliveries (
  event_id uuid not null references shorts_mvp.admin_mobile_events(id) on delete cascade,
  subscription_id uuid not null references shorts_mvp.admin_mobile_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sending','sent','skipped','expired','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  sent_at timestamptz,
  last_status_code integer,
  primary key(event_id,subscription_id)
);
create index if not exists admin_mobile_deliveries_pending_idx
  on shorts_mvp.admin_mobile_deliveries(available_at) where status in ('pending','sending');
create table if not exists shorts_mvp.admin_mobile_monitor_state (
  singleton boolean primary key default true check (singleton),
  started_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_delivery_at timestamptz
);
insert into shorts_mvp.admin_mobile_monitor_state(singleton) values(true) on conflict do nothing;

alter table shorts_mvp.admin_mobile_preferences enable row level security;
alter table shorts_mvp.admin_mobile_subscriptions enable row level security;
alter table shorts_mvp.admin_mobile_events enable row level security;
alter table shorts_mvp.admin_mobile_receipts enable row level security;
alter table shorts_mvp.admin_mobile_deliveries enable row level security;
alter table shorts_mvp.admin_mobile_monitor_state enable row level security;
revoke all on shorts_mvp.admin_mobile_preferences,shorts_mvp.admin_mobile_subscriptions,
  shorts_mvp.admin_mobile_events,shorts_mvp.admin_mobile_receipts,shorts_mvp.admin_mobile_deliveries,
  shorts_mvp.admin_mobile_monitor_state from public,anon,authenticated;
grant all on shorts_mvp.admin_mobile_preferences,shorts_mvp.admin_mobile_subscriptions,
  shorts_mvp.admin_mobile_events,shorts_mvp.admin_mobile_receipts,shorts_mvp.admin_mobile_deliveries,
  shorts_mvp.admin_mobile_monitor_state to service_role;

commit;
