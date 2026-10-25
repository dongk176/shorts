begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Public metadata only. The current catalog has no verified aspect-ratio/Shorts
-- flag; eligibility deliberately matches the ranking picker's 1–180s filter.
create function shorts_mvp.short_video_embedding_text(m jsonb)
returns text language sql immutable strict parallel safe set search_path = pg_catalog as $$
  select 'Title: ' || left(coalesce(m->>'title',''),400)
    || E'\nChannel: ' || left(coalesce(m->>'channelName',''),200)
    || E'\nCategory: ' || left(coalesce(m->>'category',''),80)
$$;
revoke all on function shorts_mvp.short_video_embedding_text(jsonb) from public, anon, authenticated;

create table shorts_mvp.short_video_embeddings (
  catalog_id text primary key references shorts_mvp.youtube_catalog(id) on delete cascade,
  model text not null default 'text-embedding-3-small' check (model='text-embedding-3-small'),
  version integer not null default 1 check (version=1),
  source_hash text not null check (length(source_hash)=32),
  embedding public.vector(768),
  embedded_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  retry_after timestamptz,
  attempts integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table shorts_mvp.short_video_embeddings enable row level security;
revoke all on shorts_mvp.short_video_embeddings from public, anon, authenticated;
-- Both search and indexing use the existing server-only DB connection.
create index short_video_embeddings_cosine on shorts_mvp.short_video_embeddings
  using hnsw (embedding public.vector_cosine_ops) where embedding is not null;
create index short_video_embeddings_pending on shorts_mvp.short_video_embeddings(retry_after,lease_until)
  where embedding is null;

-- No network work in collection transactions. Invalidate only changed input,
-- not routine view-count refreshes. Clear derived data with removed metadata.
create function shorts_mvp.invalidate_short_video_embedding()
returns trigger language plpgsql set search_path = pg_catalog,shorts_mvp as $$
begin
  if new.video_id is null or new.metadata is null or new.availability <> 'public'
    or coalesce((new.metadata->>'durationSeconds')::integer,0) not between 1 and 180
    or shorts_mvp.short_video_embedding_text(new.metadata) is distinct from shorts_mvp.short_video_embedding_text(old.metadata)
  then
    delete from shorts_mvp.short_video_embeddings where catalog_id=new.id;
  end if;
  return new;
end $$;
revoke all on function shorts_mvp.invalidate_short_video_embedding() from public, anon, authenticated;
create trigger invalidate_short_video_embedding
  after update of video_id,metadata,availability on shorts_mvp.youtube_catalog
  for each row execute function shorts_mvp.invalidate_short_video_embedding();
commit;
