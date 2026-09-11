begin;

-- Own collection history, separate from API verification and first discovery.
-- Existing catalog and source records are never rewritten by this migration.
create table shorts_mvp.youtube_collection_recency (
  catalog_id text primary key references shorts_mvp.youtube_catalog(id),
  last_collected_at timestamptz not null
);
create index youtube_collection_recency_recent on shorts_mvp.youtube_collection_recency(last_collected_at desc);
alter table shorts_mvp.youtube_collection_recency enable row level security;
revoke all on shorts_mvp.youtube_collection_recency from anon, authenticated;
grant all on shorts_mvp.youtube_collection_recency to service_role;

-- Also covers collectors and manual imports from the preceding deployment.
-- Refresh runs do not make an existing video a collected-today video.
create function shorts_mvp.record_youtube_collection_recency()
returns trigger language plpgsql set search_path=pg_catalog,shorts_mvp as $$
declare collected timestamptz;
begin
  select started_at into collected
    from shorts_mvp.youtube_collection_runs where id=new.run_id and lane<>'refresh';
  if collected is not null then
    insert into shorts_mvp.youtube_collection_recency(catalog_id,last_collected_at)
      values(new.catalog_id,collected)
      on conflict(catalog_id) do update set last_collected_at=greatest(youtube_collection_recency.last_collected_at,excluded.last_collected_at);
  end if;
  return new;
end $$;
create trigger youtube_collection_recency_record
  after insert on shorts_mvp.youtube_trending_run_items
  for each row execute function shorts_mvp.record_youtube_collection_recency();

-- Restore the latest actual collection from every retained source, including
-- manual imports. Do not use verified_at: bulk rechecks are not discoveries.
insert into shorts_mvp.youtube_collection_recency(catalog_id,last_collected_at)
select catalog_id,max(collected_at) from (
  select c.id as catalog_id,i.collected_at
    from shorts_mvp.popular_video_items i join shorts_mvp.popular_video_runs r on r.id=i.run_id
    join shorts_mvp.youtube_catalog c on c.video_id=i.video_id where r.status='ready'
  union all
  select c.id,i.collected_at
    from shorts_mvp.popular_search_items i join shorts_mvp.popular_search_runs r on r.id=i.run_id
    join shorts_mvp.youtube_catalog c on c.video_id=i.video_id where r.status='ready'
  union all
  select c.id,i.collected_at
    from shorts_mvp.free_video_items i join shorts_mvp.free_video_runs r on r.id=i.run_id
    join shorts_mvp.youtube_catalog c on c.video_id=i.video_id where r.status='ready'
  union all
  select catalog_id,last_seen_at from shorts_mvp.youtube_trending_days
  union all
  select i.catalog_id,r.started_at
    from shorts_mvp.youtube_trending_run_items i join shorts_mvp.youtube_collection_runs r on r.id=i.run_id
    where r.lane<>'refresh'
) observations group by catalog_id
on conflict(catalog_id) do update set last_collected_at=greatest(youtube_collection_recency.last_collected_at,excluded.last_collected_at);

commit;
