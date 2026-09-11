-- Apply AFTER the new application is promoted, while Japan flags are still OFF.
-- These legacy constraints keep the previous deployment writable during phase 1.
begin;
-- Catch up rows written by the old app after phase 1. No remote metadata reads.
insert into shorts_mvp.youtube_catalog_regions
select c.id,'KR',c.first_discovered_at,r.last_collected_at,c.last_trending_at,c.trending_rank
from shorts_mvp.youtube_catalog c left join shorts_mvp.youtube_collection_recency r on r.catalog_id=c.id
on conflict(catalog_id,region_code) do update set
  first_discovered_at=least(youtube_catalog_regions.first_discovered_at,excluded.first_discovered_at),
  last_collected_at=greatest(youtube_catalog_regions.last_collected_at,excluded.last_collected_at),
  last_trending_at=greatest(youtube_catalog_regions.last_trending_at,excluded.last_trending_at),
  trending_rank=case when excluded.last_trending_at>=youtube_catalog_regions.last_trending_at
    or youtube_catalog_regions.last_trending_at is null then excluded.trending_rank else youtube_catalog_regions.trending_rank end;
update shorts_mvp.youtube_catalog set metadata=jsonb_set(metadata,'{isJapanese}',to_jsonb(
  length(regexp_replace(normalize(coalesce(metadata->>'title',''),NFKC),'[^ぁ-ゖァ-ヺ]','','g'))>=2
)),updated_at=clock_timestamp() where metadata is not null and not (metadata ? 'isJapanese');
update shorts_mvp.youtube_quota_verifications set japan_activated_at=clock_timestamp();
alter table shorts_mvp.youtube_collection_runs drop constraint youtube_collection_runs_lane_scheduled_at_key;
alter table shorts_mvp.youtube_trending_days drop constraint youtube_trending_days_legacy_key;
commit;
