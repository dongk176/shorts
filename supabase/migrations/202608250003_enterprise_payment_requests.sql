begin;

set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table if not exists shorts_mvp.enterprise_payment_requests (
  id uuid primary key default gen_random_uuid(),
  create_request_id uuid not null unique,
  managed_account_id uuid not null references shorts_mvp.managed_login_accounts(id) on delete restrict,
  public_token uuid not null default gen_random_uuid() unique,
  customer_name text not null check (char_length(customer_name) between 1 and 100),
  customer_email text check (customer_email is null or char_length(customer_email) <= 100),
  title text not null check (char_length(title) between 1 and 100),
  status text not null default 'open' check (
    status in ('open','partial','paid','canceled')
  ),
  expires_at timestamptz not null,
  paid_at timestamptz,
  canceled_at timestamptz,
  created_by_user_id uuid not null references shorts_mvp.app_users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (expires_at > created_at),
  check ((status='paid')=(paid_at is not null)),
  check ((status='canceled')=(canceled_at is not null))
);

create index if not exists enterprise_payment_requests_account_created_idx
  on shorts_mvp.enterprise_payment_requests (managed_account_id,created_at desc);
create index if not exists enterprise_payment_requests_open_expiry_idx
  on shorts_mvp.enterprise_payment_requests (expires_at)
  where status in ('open','partial');

create table if not exists shorts_mvp.enterprise_payment_items (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references shorts_mvp.enterprise_payment_requests(id) on delete restrict,
  sort_order smallint not null check (sort_order between 1 and 10),
  name text not null check (char_length(name) between 1 and 100),
  amount_krw integer not null check (amount_krw between 100 and 1000000000),
  status text not null default 'pending' check (
    status in ('pending','confirming','paid','manual_review')
  ),
  paid_attempt_id uuid,
  paid_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (payment_request_id,sort_order),
  check ((status='paid')=(paid_at is not null))
);

create index if not exists enterprise_payment_items_request_idx
  on shorts_mvp.enterprise_payment_items (payment_request_id,sort_order);

create table if not exists shorts_mvp.enterprise_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  payment_item_id uuid not null references shorts_mvp.enterprise_payment_items(id) on delete restrict,
  order_id text not null unique check (
    char_length(order_id) between 6 and 64
    and order_id ~ '^[A-Za-z0-9_-]+$'
  ),
  amount_krw integer not null check (amount_krw between 100 and 1000000000),
  status text not null default 'prepared' check (
    status in ('prepared','confirming','paid','failed','manual_review')
  ),
  payment_key text unique check (payment_key is null or char_length(payment_key) <= 200),
  provider_status text check (provider_status is null or char_length(provider_status) <= 50),
  payment_method text check (payment_method is null or char_length(payment_method) <= 50),
  receipt_url text check (receipt_url is null or char_length(receipt_url) <= 2000),
  provider_error_code text check (provider_error_code is null or char_length(provider_error_code) <= 100),
  provider_error_message text check (provider_error_message is null or char_length(provider_error_message) <= 300),
  approved_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((status='paid')=(approved_at is not null))
);

alter table shorts_mvp.enterprise_payment_items
  add constraint enterprise_payment_items_paid_attempt_id_fkey
  foreign key (paid_attempt_id)
  references shorts_mvp.enterprise_payment_attempts(id)
  on delete restrict;

create index if not exists enterprise_payment_attempts_item_created_idx
  on shorts_mvp.enterprise_payment_attempts (payment_item_id,created_at desc);
create unique index if not exists enterprise_payment_attempts_one_live_per_item_idx
  on shorts_mvp.enterprise_payment_attempts (payment_item_id)
  where status in ('prepared','confirming','manual_review');

alter table shorts_mvp.enterprise_payment_requests enable row level security;
alter table shorts_mvp.enterprise_payment_items enable row level security;
alter table shorts_mvp.enterprise_payment_attempts enable row level security;

revoke all on shorts_mvp.enterprise_payment_requests from anon, authenticated;
revoke all on shorts_mvp.enterprise_payment_items from anon, authenticated;
revoke all on shorts_mvp.enterprise_payment_attempts from anon, authenticated;
grant all on shorts_mvp.enterprise_payment_requests to service_role;
grant all on shorts_mvp.enterprise_payment_items to service_role;
grant all on shorts_mvp.enterprise_payment_attempts to service_role;

drop trigger if exists enterprise_payment_requests_set_updated_at
  on shorts_mvp.enterprise_payment_requests;
create trigger enterprise_payment_requests_set_updated_at
before update on shorts_mvp.enterprise_payment_requests
for each row execute function shorts_mvp.set_updated_at();

drop trigger if exists enterprise_payment_items_set_updated_at
  on shorts_mvp.enterprise_payment_items;
create trigger enterprise_payment_items_set_updated_at
before update on shorts_mvp.enterprise_payment_items
for each row execute function shorts_mvp.set_updated_at();

drop trigger if exists enterprise_payment_attempts_set_updated_at
  on shorts_mvp.enterprise_payment_attempts;
create trigger enterprise_payment_attempts_set_updated_at
before update on shorts_mvp.enterprise_payment_attempts
for each row execute function shorts_mvp.set_updated_at();

comment on table shorts_mvp.enterprise_payment_requests is
  'Administrator-issued capability links for one or more enterprise card payments.';
comment on table shorts_mvp.enterprise_payment_attempts is
  'Immutable Toss order attempts. A retry always receives a fresh order_id.';

commit;
