begin;
-- Additive rollout: no schedule or read path is enabled by this migration.
create table shorts_mvp.youtube_catalog (
  id text primary key,
  video_id text unique,
  metadata jsonb,
  first_discovered_at timestamptz not null,
  verified_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz,
  last_trending_at timestamptz,
  trending_rank integer,
  availability text not null default 'public' check (availability in ('public','unavailable','expired')),
  refresh_after timestamptz not null default now(),
  refresh_lease_until timestamptz,
  check (metadata is null or metadata->>'videoId'=video_id)
);
create index youtube_catalog_refresh on shorts_mvp.youtube_catalog(refresh_after,verified_at) where video_id is not null;
create index youtube_catalog_trending on shorts_mvp.youtube_catalog(last_trending_at desc);
create index youtube_catalog_updated on shorts_mvp.youtube_catalog(updated_at desc);
create index youtube_catalog_verified on shorts_mvp.youtube_catalog(verified_at desc);
create index youtube_catalog_license_views on shorts_mvp.youtube_catalog
  ((metadata->>'license'),((metadata->>'viewCount')::bigint) desc) where availability='public' and metadata is not null;
create table shorts_mvp.youtube_catalog_imports (
  source text not null,
  legacy_run_id uuid not null,
  next_offset integer not null default 0,
  completed_at timestamptz,
  primary key(source,legacy_run_id)
);
create table shorts_mvp.youtube_collection_runs (
  id uuid primary key default gen_random_uuid(),
  lane text not null check(lane in ('trending','views','reusable','free','refresh')),
  scheduled_at timestamptz not null,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  status text not null default 'running' check(status in ('running','success','partial','failed')),
  page_count integer not null default 0,
  item_count integer not null default 0,
  failed_pages integer not null default 0,
  legacy boolean not null default false,
  unique(lane,scheduled_at)
);
create index youtube_collection_runs_latest on shorts_mvp.youtube_collection_runs(lane,finished_at desc);
create index youtube_collection_runs_calendar on shorts_mvp.youtube_collection_runs(lane,started_at);
create table shorts_mvp.youtube_trending_days (
  day date not null,
  catalog_id text not null references shorts_mvp.youtube_catalog(id),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  primary key(day,catalog_id)
);
create table shorts_mvp.youtube_trending_run_items (
  run_id uuid not null references shorts_mvp.youtube_collection_runs(id) on delete cascade,
  catalog_id text not null references shorts_mvp.youtube_catalog(id),
  primary key(run_id,catalog_id)
);
create table shorts_mvp.youtube_search_positions (
  source_key text primary key,
  conditions jsonb not null,
  page_token text,
  updated_at timestamptz not null default now()
);
create table shorts_mvp.youtube_list_versions (
  id uuid primary key default gen_random_uuid(),
  filter_key text not null,
  generation text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '48 hours',
  collected_at timestamptz,
  catalog_ids text[] not null
);
create index youtube_list_versions_filter on shorts_mvp.youtube_list_versions(filter_key,created_at desc);
create table shorts_mvp.youtube_quota_verifications (
  project_id text primary key,
  key_fingerprint text not null,
  search_daily_limit integer not null,
  general_daily_limit integer not null,
  other_clients_reviewed boolean not null default false,
  verified_at timestamptz not null,
  evidence text not null,
  expanded_at timestamptz,
  backfill_verified_at timestamptz
);
create table shorts_mvp.youtube_quota_attempts (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  quota_day date not null,
  bucket text not null check(bucket in ('search','general')),
  purpose text not null check(purpose in ('analysis','trending','views','reusable','free','refresh')),
  units integer not null check(units>0),
  attempted_at timestamptz not null default clock_timestamp()
);
create index youtube_quota_attempts_day on shorts_mvp.youtube_quota_attempts(project_id,quota_day,bucket,purpose);
-- One lock per Google project/PT day serializes foreground and background reservations.
-- Reservations are intentionally never refunded, including timeout and process death.
create function shorts_mvp.reserve_youtube_quota(p_project text,p_bucket text,p_purpose text,p_units integer)
returns uuid language plpgsql set search_path=pg_catalog,shorts_mvp as $$
declare d date := (clock_timestamp() at time zone 'America/Los_Angeles')::date;
  used_total bigint; used_background bigint; used_lane bigint; result uuid;
begin
  if p_project='' or p_units<1 or p_units>100 or p_bucket not in ('search','general')
    or p_purpose not in ('analysis','trending','views','reusable','free','refresh') then
    raise exception 'INVALID_YOUTUBE_QUOTA_RESERVATION';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_project || ':' || d::text,0));
  select coalesce(sum(units),0),coalesce(sum(units) filter(where purpose<>'analysis'),0),
    coalesce(sum(units) filter(where purpose=p_purpose),0)
    into used_total,used_background,used_lane
    from shorts_mvp.youtube_quota_attempts where project_id=p_project and quota_day=d and bucket=p_bucket;
  if p_bucket='search' then
    if p_purpose not in ('views','reusable','free') or used_total+p_units>90
      or used_lane+p_units>(case p_purpose when 'views' then 40 when 'reusable' then 20 else 30 end) then
      return null;
    end if;
  elsif used_total+p_units>9000 or (p_purpose<>'analysis' and used_background+p_units>3000) then
    return null;
  end if;
  insert into shorts_mvp.youtube_quota_attempts(project_id,quota_day,bucket,purpose,units)
    values(p_project,d,p_bucket,p_purpose,p_units) returning id into result;
  return result;
end $$;
revoke all on function shorts_mvp.reserve_youtube_quota(text,text,text,integer) from public;
-- Server SQL only: never expose catalog, fingerprints, or quota controls through PostgREST.
alter table shorts_mvp.youtube_catalog enable row level security;
alter table shorts_mvp.youtube_collection_runs enable row level security;
alter table shorts_mvp.youtube_trending_days enable row level security;
alter table shorts_mvp.youtube_trending_run_items enable row level security;
alter table shorts_mvp.youtube_search_positions enable row level security;
alter table shorts_mvp.youtube_list_versions enable row level security;
alter table shorts_mvp.youtube_quota_verifications enable row level security;
alter table shorts_mvp.youtube_quota_attempts enable row level security;
alter table shorts_mvp.youtube_catalog_imports enable row level security;
alter table shorts_mvp.popular_filter_usage_events add column if not exists selected_date date;

commit;
