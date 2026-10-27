-- Private server-only result feedback. No billing/reward changes.
create table shorts_mvp.ranking_feedback (
  operation_id uuid primary key references shorts_mvp.ranking_operations(id) on delete cascade,
  user_id uuid not null references shorts_mvp.app_users(id),
  rating text check (rating in ('good','okay','poor')),
  comment text not null default '' check (char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  check (rating is not null or comment = '')
);
create index ranking_feedback_recent on shorts_mvp.ranking_feedback(created_at desc) where rating is not null;
alter table shorts_mvp.ranking_feedback enable row level security;
revoke all on shorts_mvp.ranking_feedback from public, anon, authenticated;
