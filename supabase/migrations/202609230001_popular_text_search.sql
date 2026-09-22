begin;

-- Search uses the current canonical catalog, not expired legacy snapshots.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create or replace function shorts_mvp.popular_search_normalize(value text)
returns text language sql immutable parallel safe as $$
  select btrim(regexp_replace(lower(normalize(coalesce(value,''), NFKC)), '[[:space:]]+', ' ', 'g'))
$$;

-- Do not move an already-installed extension or assume it is in public.
-- SQL wrappers inline so PostgreSQL can use the underlying trigram operator indexes.
do $migration$
declare extension_schema text;
begin
  select n.nspname into strict extension_schema from pg_extension e
    join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_trgm';
  execute format('create or replace function shorts_mvp.popular_search_word_match(query text, value text)
    returns boolean language sql stable parallel safe as %L',
    format('select query operator(%I.<%%) value',extension_schema));
  execute format('create or replace function shorts_mvp.popular_search_word_score(query text, value text)
    returns real language sql immutable parallel safe as %L',
    format('select %I.word_similarity(query,value)',extension_schema));
end $migration$;

revoke all on function shorts_mvp.popular_search_normalize(text),
  shorts_mvp.popular_search_word_match(text,text), shorts_mvp.popular_search_word_score(text,text)
  from public,anon,authenticated;
grant execute on function shorts_mvp.popular_search_normalize(text),
  shorts_mvp.popular_search_word_match(text,text), shorts_mvp.popular_search_word_score(text,text)
  to service_role;
commit;
