begin;

alter table shorts_mvp.app_users
  add column if not exists is_admin boolean not null default false;
create index if not exists app_users_admin_idx
  on shorts_mvp.app_users (id) where is_admin;

-- The initial operator is intentionally assigned in the database. Application
-- code never grants administrator access from a matching email string alone.
update shorts_mvp.app_users
set is_admin=true,updated_at=now()
where lower(email)=lower('dmsthaalcls@gmail.com');

alter table shorts_mvp.billing_orders
  add column if not exists provider text,
  add column if not exists refunded_amount_krw integer not null default 0,
  add column if not exists refund_status text not null default 'none';
update shorts_mvp.billing_orders set provider='nicepay' where provider is null;
alter table shorts_mvp.billing_orders alter column provider set not null;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='shorts_mvp' and table_name='billing_orders'
      and column_name='provider_track_id'
  ) then
    alter table shorts_mvp.billing_orders alter column provider set default 'thepayone';
  else
    alter table shorts_mvp.billing_orders alter column provider set default 'nicepay';
  end if;
end $$;
alter table shorts_mvp.billing_orders
  drop constraint if exists billing_orders_provider_check,
  drop constraint if exists billing_orders_refunded_amount_check,
  drop constraint if exists billing_orders_refund_status_check;
alter table shorts_mvp.billing_orders
  add constraint billing_orders_provider_check
  check (provider in ('nicepay','thepayone')),
  add constraint billing_orders_refunded_amount_check
  check (refunded_amount_krw >= 0 and refunded_amount_krw <= amount_krw),
  add constraint billing_orders_refund_status_check
  check (refund_status in ('none','partial','full','manual_review'));

alter table shorts_mvp.user_subscriptions
  add column if not exists billing_review_status text not null default 'clear',
  add column if not exists billing_review_reason text;
alter table shorts_mvp.user_subscriptions
  drop constraint if exists user_subscriptions_billing_review_status_check;
alter table shorts_mvp.user_subscriptions
  add constraint user_subscriptions_billing_review_status_check
  check (billing_review_status in ('clear','manual_review'));

create table if not exists shorts_mvp.admin_billing_refunds (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  billing_order_id uuid not null references shorts_mvp.billing_orders(id) on delete restrict,
  requested_by_user_id uuid not null references shorts_mvp.app_users(id) on delete restrict,
  provider text not null check (provider in ('thepayone')),
  provider_track_id text not null unique,
  root_provider_transaction_id text not null,
  provider_refund_transaction_id text unique,
  amount_krw integer not null check (amount_krw > 0),
  reason text not null check (char_length(reason) between 2 and 500),
  status text not null default 'pending' check (
    status in ('pending','processing','succeeded','failed','manual_review')
  ),
  entitlement_action_status text not null default 'not_required' check (
    entitlement_action_status in ('not_required','revoked','manual_review')
  ),
  provider_code text,
  failure_message text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists admin_billing_refunds_order_idx
  on shorts_mvp.admin_billing_refunds (billing_order_id,requested_at desc);
create index if not exists admin_billing_refunds_status_idx
  on shorts_mvp.admin_billing_refunds (status,requested_at desc);

create table if not exists shorts_mvp.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references shorts_mvp.app_users(id) on delete restrict,
  action text not null check (char_length(action) between 2 and 100),
  entity_type text not null check (char_length(entity_type) between 2 and 100),
  entity_id text not null check (char_length(entity_id) between 1 and 200),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_logs_actor_created_idx
  on shorts_mvp.admin_audit_logs (actor_user_id,created_at desc);
create index if not exists admin_audit_logs_entity_idx
  on shorts_mvp.admin_audit_logs (entity_type,entity_id,created_at desc);

alter table shorts_mvp.admin_billing_refunds enable row level security;
alter table shorts_mvp.admin_audit_logs enable row level security;
revoke all on shorts_mvp.admin_billing_refunds from anon, authenticated;
revoke all on shorts_mvp.admin_audit_logs from anon, authenticated;
grant all on shorts_mvp.admin_billing_refunds to service_role;
grant all on shorts_mvp.admin_audit_logs to service_role;

drop trigger if exists admin_billing_refunds_set_updated_at
  on shorts_mvp.admin_billing_refunds;
create trigger admin_billing_refunds_set_updated_at
before update on shorts_mvp.admin_billing_refunds
for each row execute function shorts_mvp.set_updated_at();

commit;
