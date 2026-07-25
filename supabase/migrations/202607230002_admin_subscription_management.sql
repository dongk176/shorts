begin;

create table if not exists shorts_mvp.admin_subscription_changes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  subscription_id uuid not null references shorts_mvp.user_subscriptions(id) on delete restrict,
  user_id uuid not null references shorts_mvp.app_users(id) on delete restrict,
  requested_by_user_id uuid not null references shorts_mvp.app_users(id) on delete restrict,
  previous_status text not null check (
    previous_status in ('pending','trialing','active','past_due','canceled','expired')
  ),
  target_status text not null check (
    target_status in ('active','past_due','canceled','expired')
  ),
  reason text not null check (char_length(reason) between 2 and 500),
  provider_action text not null default 'none' check (
    provider_action in ('none','enable','pause')
  ),
  provider_action_status text not null default 'not_required' check (
    provider_action_status in ('not_required','pending','succeeded','failed','manual_review')
  ),
  status text not null default 'pending' check (
    status in ('pending','processing','succeeded','failed','manual_review')
  ),
  failure_message text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists admin_subscription_changes_subscription_idx
  on shorts_mvp.admin_subscription_changes (subscription_id,requested_at desc);
create index if not exists admin_subscription_changes_user_idx
  on shorts_mvp.admin_subscription_changes (user_id,requested_at desc);
create index if not exists admin_subscription_changes_status_idx
  on shorts_mvp.admin_subscription_changes (status,requested_at desc);
create unique index if not exists admin_subscription_changes_one_processing_idx
  on shorts_mvp.admin_subscription_changes (subscription_id)
  where status in ('pending','processing');

alter table shorts_mvp.admin_subscription_changes enable row level security;
revoke all on shorts_mvp.admin_subscription_changes from anon, authenticated;
grant all on shorts_mvp.admin_subscription_changes to service_role;

drop trigger if exists admin_subscription_changes_set_updated_at
  on shorts_mvp.admin_subscription_changes;
create trigger admin_subscription_changes_set_updated_at
before update on shorts_mvp.admin_subscription_changes
for each row execute function shorts_mvp.set_updated_at();

commit;
