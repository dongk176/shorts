begin;
create table shorts_mvp.subscription_cancellation_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  subscription_id uuid not null references shorts_mvp.user_subscriptions(id) on delete cascade,
  payment_provider text,
  plan_code text not null,
  billing_cycle text not null,
  reason text not null check (reason in ('price','less_usage','quality','missing_features','technical','alternative','other')),
  detail text check (detail is null or char_length(btrim(detail)) between 1 and 1000),
  message text check (message is null or char_length(btrim(message)) between 1 and 2000),
  alternative_service text check (alternative_service is null or char_length(btrim(alternative_service)) between 1 and 100),
  alternative_undecided boolean not null default false,
  canceled_at timestamptz not null,
  access_until timestamptz not null,
  created_at timestamptz not null default now(),
  unique(subscription_id,canceled_at),
  check (reason <> 'other' or (detail is not null and char_length(btrim(detail)) > 0)),
  check (reason = 'alternative' or (alternative_service is null and not alternative_undecided)),
  check (not alternative_undecided or alternative_service is null)
);
create index subscription_cancellation_feedback_created_idx on shorts_mvp.subscription_cancellation_feedback(created_at desc);
create index subscription_cancellation_feedback_user_idx on shorts_mvp.subscription_cancellation_feedback(user_id);
alter table shorts_mvp.subscription_cancellation_feedback enable row level security;
revoke all on shorts_mvp.subscription_cancellation_feedback from public, anon, authenticated;
grant select, insert, update, delete on shorts_mvp.subscription_cancellation_feedback to service_role;
comment on table shorts_mvp.subscription_cancellation_feedback is 'Required cancellation survey, stored with confirmed period-end cancellation. Server-only access.';
commit;
