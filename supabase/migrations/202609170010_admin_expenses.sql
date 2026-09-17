begin;

create table shorts_mvp.admin_expense_access (
  user_id uuid primary key references shorts_mvp.app_users(id) on delete restrict,
  created_at timestamptz not null default now()
);
-- Only the already-appointed initial operator. No runtime email-based grants.
insert into shorts_mvp.admin_expense_access (user_id)
select id from shorts_mvp.app_users where is_admin and lower(email)='dmsthaalcls@gmail.com';

create table shorts_mvp.admin_expenses (
  id uuid primary key,
  version integer not null check (version > 0),
  content jsonb not null check (jsonb_typeof(content)='object'),
  created_by uuid not null references shorts_mvp.app_users(id) on delete restrict,
  updated_by uuid not null references shorts_mvp.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((content->>'amount')::bigint between 1 and 1000000000),
  check (content->>'stage' in ('draft','confirmed')),
  check (content->>'month' ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$')
);
create index admin_expenses_month_idx on shorts_mvp.admin_expenses ((content->>'month')) where deleted_at is null;

-- Small private receipts stay with the ledger and its database backups. No public object URLs.
create table shorts_mvp.admin_expense_receipts (
  id uuid primary key,
  expense_id uuid not null references shorts_mvp.admin_expenses(id) on delete restrict,
  name text not null,
  content_type text not null check (content_type in ('application/pdf','image/png','image/jpeg','image/webp')),
  body bytea not null check (octet_length(body) between 1 and 2097152),
  sha256 text not null,
  created_at timestamptz not null default now()
);
create index admin_expense_receipts_expense_idx on shorts_mvp.admin_expense_receipts(expense_id);
create table shorts_mvp.admin_expense_changes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  payload_hash text not null,
  expense_id uuid not null references shorts_mvp.admin_expenses(id) on delete restrict,
  actor_user_id uuid not null references shorts_mvp.app_users(id) on delete restrict,
  action text not null check (action in ('created','updated','deleted')),
  before_snapshot jsonb,
  after_snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index admin_expense_changes_history_idx on shorts_mvp.admin_expense_changes(expense_id,created_at desc);

alter table shorts_mvp.admin_expense_access enable row level security;
alter table shorts_mvp.admin_expenses enable row level security;
alter table shorts_mvp.admin_expense_receipts enable row level security;
alter table shorts_mvp.admin_expense_changes enable row level security;
revoke all on shorts_mvp.admin_expense_access, shorts_mvp.admin_expenses,
  shorts_mvp.admin_expense_receipts, shorts_mvp.admin_expense_changes from public, anon, authenticated;
grant select on shorts_mvp.admin_expense_access to service_role;
grant select,insert,update on shorts_mvp.admin_expenses to service_role;
grant select,insert on shorts_mvp.admin_expense_receipts, shorts_mvp.admin_expense_changes to service_role;
commit;
