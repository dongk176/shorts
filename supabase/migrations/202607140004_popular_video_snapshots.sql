begin;

create table if not exists shorts_mvp.popular_video_runs (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  status text not null check (status in ('collecting', 'ready', 'failed')),
  expected_categories integer not null default 9 check (expected_categories = 9),
  completed_categories integer not null default 0 check (completed_categories between 0 and 9),
  page_count integer not null default 0 check (page_count >= 0),
  item_count integer not null default 0 check (item_count >= 0),
  category_summary jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '3 days'),
  created_at timestamptz not null default now()
);

create unique index if not exists popular_video_runs_single_collecting_idx
  on shorts_mvp.popular_video_runs (status)
  where status = 'collecting';
create index if not exists popular_video_runs_ready_completed_idx
  on shorts_mvp.popular_video_runs (completed_at desc)
  where status = 'ready';
create index if not exists popular_video_runs_expires_idx
  on shorts_mvp.popular_video_runs (expires_at);

create table if not exists shorts_mvp.popular_video_items (
  run_id uuid not null references shorts_mvp.popular_video_runs(id) on delete cascade,
  video_id text not null check (char_length(video_id) between 6 and 32),
  category text not null check (category in (
    'entertainment', 'gaming', 'sports', 'music', 'education',
    'news', 'science', 'travel', 'howto'
  )),
  category_rank integer not null check (category_rank > 0),
  page_number integer not null check (page_number > 0),
  title text not null check (char_length(title) between 1 and 500),
  channel_name text not null check (char_length(channel_name) between 1 and 500),
  thumbnail_url text not null,
  duration_seconds integer not null check (duration_seconds > 0),
  view_count bigint not null check (view_count >= 0),
  published_at timestamptz not null,
  license text not null check (license in ('creativeCommon', 'youtube')),
  collected_at timestamptz not null default now(),
  primary key (run_id, category, video_id)
);

create index if not exists popular_video_items_category_rank_idx
  on shorts_mvp.popular_video_items (run_id, category, category_rank, view_count desc);
create index if not exists popular_video_items_views_idx
  on shorts_mvp.popular_video_items (run_id, view_count desc, video_id);
create index if not exists popular_video_items_license_views_idx
  on shorts_mvp.popular_video_items (run_id, license, view_count desc, video_id);

alter table shorts_mvp.popular_video_runs enable row level security;
alter table shorts_mvp.popular_video_items enable row level security;
revoke all on table shorts_mvp.popular_video_runs from anon, authenticated;
revoke all on table shorts_mvp.popular_video_items from anon, authenticated;
grant all on table shorts_mvp.popular_video_runs to service_role;
grant all on table shorts_mvp.popular_video_items to service_role;

commit;
