-- Applied outside a transaction to avoid blocking catalog ingestion.
-- The preflight must resolve gin_trgm_ops to the installed extension schema.
select set_config('search_path','pg_catalog,shorts_mvp,' || quote_ident(n.nspname),false)
from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_trgm';
create index concurrently if not exists youtube_catalog_search_title
  on shorts_mvp.youtube_catalog using gin (shorts_mvp.popular_search_normalize(metadata->>'title') gin_trgm_ops)
  where availability='public' and metadata is not null and video_id is not null;
create index concurrently if not exists youtube_catalog_search_channel
  on shorts_mvp.youtube_catalog using gin (shorts_mvp.popular_search_normalize(metadata->>'channelName') gin_trgm_ops)
  where availability='public' and metadata is not null and video_id is not null;
create index concurrently if not exists youtube_catalog_search_title_compact
  on shorts_mvp.youtube_catalog using gin (replace(shorts_mvp.popular_search_normalize(metadata->>'title'),' ','') gin_trgm_ops)
  where availability='public' and metadata is not null and video_id is not null;
create index concurrently if not exists youtube_catalog_search_channel_compact
  on shorts_mvp.youtube_catalog using gin (replace(shorts_mvp.popular_search_normalize(metadata->>'channelName'),' ','') gin_trgm_ops)
  where availability='public' and metadata is not null and video_id is not null;
reset search_path;
