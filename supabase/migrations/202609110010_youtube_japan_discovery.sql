begin;
alter table shorts_mvp.youtube_collection_runs add column region_code text not null default 'KR' check(region_code in ('KR','JP'));
alter table shorts_mvp.youtube_collection_runs add unique(lane,region_code,scheduled_at);
create index youtube_collection_runs_region_latest on shorts_mvp.youtube_collection_runs(region_code,lane,finished_at desc) where status='success';
alter table shorts_mvp.youtube_quota_attempts add column region_code text not null default 'KR' check(region_code in ('KR','JP'));
alter table shorts_mvp.youtube_quota_verifications add column japan_verified_at timestamptz;
alter table shorts_mvp.youtube_quota_verifications add column japan_evidence text;
alter table shorts_mvp.popular_filter_usage_events add column japanese_only boolean not null default false;
alter table shorts_mvp.youtube_list_versions add column current_run_ids uuid[] not null default '{}';
create table shorts_mvp.youtube_catalog_regions (
  catalog_id text not null references shorts_mvp.youtube_catalog(id),
  region_code text not null check(region_code in ('KR','JP')),
  first_discovered_at timestamptz not null,
  last_collected_at timestamptz,
  last_trending_at timestamptz,
  trending_rank integer,
  primary key(catalog_id,region_code)
);
insert into shorts_mvp.youtube_catalog_regions
select c.id,'KR',c.first_discovered_at,r.last_collected_at,c.last_trending_at,c.trending_rank
from shorts_mvp.youtube_catalog c left join shorts_mvp.youtube_collection_recency r on r.catalog_id=c.id;
create index youtube_catalog_regions_recent on shorts_mvp.youtube_catalog_regions(region_code,last_trending_at desc);
alter table shorts_mvp.youtube_catalog_regions enable row level security;
revoke all on shorts_mvp.youtube_catalog_regions from anon,authenticated;
grant all on shorts_mvp.youtube_catalog_regions to service_role;
alter table shorts_mvp.youtube_trending_days add column region_code text not null default 'KR' check(region_code in ('KR','JP'));
alter table shorts_mvp.youtube_trending_days drop constraint youtube_trending_days_pkey;
alter table shorts_mvp.youtube_trending_days add primary key(day,catalog_id,region_code);
-- Old deployment upserts continue to work until the new application is promoted.
alter table shorts_mvp.youtube_trending_days add constraint youtube_trending_days_legacy_key unique(day,catalog_id);
-- Existing stored titles only. No backfill API calls, and no inference from kanji alone.
update shorts_mvp.youtube_catalog set metadata=jsonb_set(metadata,'{isJapanese}',to_jsonb(
  length(regexp_replace(normalize(coalesce(metadata->>'title',''),NFKC),'[^ぁ-ゖァ-ヺ]','','g'))>=2
)),updated_at=clock_timestamp() where metadata is not null;
alter table shorts_mvp.youtube_quota_verifications
  add column japan_collection_enabled boolean not null default false,
  add column japan_discovery_enabled boolean not null default false,
  add column japan_activated_at timestamptz;
create table shorts_mvp.youtube_japan_settings_audit (
  id uuid primary key default gen_random_uuid(), project_id text not null,
  actor_id uuid not null, collection_enabled boolean not null, discovery_enabled boolean not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table shorts_mvp.youtube_japan_settings_audit enable row level security;
revoke all on shorts_mvp.youtube_japan_settings_audit from public,anon,authenticated;
grant select,insert on shorts_mvp.youtube_japan_settings_audit to service_role;
-- One JP batch per Pacific quota day, including a manual initial collection.
create table shorts_mvp.youtube_japan_batches (
  project_id text not null, quota_day date not null, scheduled_at timestamptz not null,
  started_at timestamptz not null default clock_timestamp(),
  primary key(project_id,quota_day)
);
alter table shorts_mvp.youtube_japan_batches enable row level security;
revoke all on shorts_mvp.youtube_japan_batches from public,anon,authenticated;
grant select,insert on shorts_mvp.youtube_japan_batches to service_role;
commit;
