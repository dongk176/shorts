-- Separate read-only overseas administrators from the existing full-admin flag.
create table shorts_mvp.admin_role_assignments (
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  role text not null check (role = 'overseas_admin'),
  granted_by_user_id uuid not null references shorts_mvp.app_users(id),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

alter table shorts_mvp.admin_role_assignments enable row level security;
revoke all on shorts_mvp.admin_role_assignments from public, anon, authenticated;
grant select, insert, update, delete on shorts_mvp.admin_role_assignments to service_role;
comment on table shorts_mvp.admin_role_assignments is
  'Server-managed administrator roles. Overseas administrators do not receive app_users.is_admin.';
