begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';
create table if not exists shorts_mvp.saved_videos (
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  catalog_id text not null references shorts_mvp.youtube_catalog(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id,catalog_id)
);
create index if not exists saved_videos_user_recent_idx
  on shorts_mvp.saved_videos(user_id,created_at desc,catalog_id desc);
alter table shorts_mvp.saved_videos enable row level security;
revoke all on table shorts_mvp.saved_videos from anon,authenticated;
grant all on table shorts_mvp.saved_videos to service_role;
comment on table shorts_mvp.saved_videos is 'Account-owned bookmarks; metadata stays in the refreshed YouTube catalog. Server-only access.';
commit;
