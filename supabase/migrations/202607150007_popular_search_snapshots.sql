begin;

create table if not exists shorts_mvp.popular_search_runs (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  status text not null check (status in ('collecting', 'ready', 'failed')),
  page_count integer not null default 0 check (page_count >= 0),
  item_count integer not null default 0 check (item_count >= 0),
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists popular_search_runs_single_collecting_idx
  on shorts_mvp.popular_search_runs (status)
  where status = 'collecting';
create index if not exists popular_search_runs_ready_completed_idx
  on shorts_mvp.popular_search_runs (completed_at desc)
  where status = 'ready';

create table if not exists shorts_mvp.popular_search_items (
  run_id uuid not null references shorts_mvp.popular_search_runs(id) on delete cascade,
  video_id text not null check (char_length(video_id) between 6 and 32),
  category text not null check (category in (
    'entertainment', 'gaming', 'sports', 'music',
    'news', 'science', 'howto'
  )),
  search_rank integer not null check (search_rank > 0),
  page_number integer not null check (page_number > 0),
  title text not null check (char_length(title) between 1 and 500),
  channel_name text not null check (char_length(channel_name) between 1 and 500),
  thumbnail_url text not null,
  duration_seconds integer not null check (duration_seconds > 0),
  view_count bigint not null check (view_count >= 0),
  published_at timestamptz not null,
  license text not null check (license in ('creativeCommon', 'youtube')),
  collected_at timestamptz not null default now(),
  primary key (run_id, video_id)
);

create index if not exists popular_search_items_views_idx
  on shorts_mvp.popular_search_items (run_id, view_count desc, video_id);
create index if not exists popular_search_items_category_views_idx
  on shorts_mvp.popular_search_items (run_id, category, view_count desc, video_id);
create index if not exists popular_search_items_license_views_idx
  on shorts_mvp.popular_search_items (run_id, license, view_count desc, video_id);

alter table shorts_mvp.popular_search_runs enable row level security;
alter table shorts_mvp.popular_search_items enable row level security;
revoke all on table shorts_mvp.popular_search_runs from anon, authenticated;
revoke all on table shorts_mvp.popular_search_items from anon, authenticated;
grant all on table shorts_mvp.popular_search_runs to service_role;
grant all on table shorts_mvp.popular_search_items to service_role;

commit;
