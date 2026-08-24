begin;

create table if not exists shorts_mvp.payment_test_recurring_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  registration_id uuid not null references shorts_mvp.payment_method_registrations(id) on delete restrict,
  request_id uuid not null unique,
  status text not null default 'running' check (
    status in ('running', 'completed', 'stopped', 'failed', 'unknown')
  ),
  amount integer not null default 1000 check (amount = 1000),
  interval_seconds integer not null default 300 check (interval_seconds = 300),
  target_charge_count integer not null default 3 check (target_charge_count = 3),
  succeeded_charge_count integer not null default 0 check (succeeded_charge_count between 0 and 3),
  payer_name text,
  payer_email text,
  payer_tel text,
  next_charge_at timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'running' and next_charge_at is not null and payer_name is not null and payer_email is not null and payer_tel is not null)
    or
    (status <> 'running' and next_charge_at is null and payer_name is null and payer_email is null and payer_tel is null)
  )
);

create unique index if not exists payment_test_recurring_runs_one_open_per_user_idx
  on shorts_mvp.payment_test_recurring_runs (user_id)
  where status in ('running', 'unknown');
create index if not exists payment_test_recurring_runs_user_created_idx
  on shorts_mvp.payment_test_recurring_runs (user_id, created_at desc);

create table if not exists shorts_mvp.payment_test_charge_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references shorts_mvp.payment_test_recurring_runs(id) on delete cascade,
  sequence_no integer not null check (sequence_no between 1 and 3),
  order_id text not null unique,
  amount integer not null check (amount = 1000),
  status text not null default 'processing' check (
    status in ('processing', 'succeeded', 'failed', 'unknown')
  ),
  transaction_id text unique,
  result_code text,
  scheduled_for timestamptz not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, sequence_no)
);

create index if not exists payment_test_charge_attempts_run_created_idx
  on shorts_mvp.payment_test_charge_attempts (run_id, created_at);

alter table shorts_mvp.payment_test_recurring_runs enable row level security;
alter table shorts_mvp.payment_test_charge_attempts enable row level security;
revoke all on shorts_mvp.payment_test_recurring_runs from anon, authenticated;
revoke all on shorts_mvp.payment_test_charge_attempts from anon, authenticated;
grant all on shorts_mvp.payment_test_recurring_runs to service_role;
grant all on shorts_mvp.payment_test_charge_attempts to service_role;

drop trigger if exists payment_test_recurring_runs_set_updated_at
  on shorts_mvp.payment_test_recurring_runs;
create trigger payment_test_recurring_runs_set_updated_at
before update on shorts_mvp.payment_test_recurring_runs
for each row execute function shorts_mvp.set_updated_at();

drop trigger if exists payment_test_charge_attempts_set_updated_at
  on shorts_mvp.payment_test_charge_attempts;
create trigger payment_test_charge_attempts_set_updated_at
before update on shorts_mvp.payment_test_charge_attempts
for each row execute function shorts_mvp.set_updated_at();

commit;
