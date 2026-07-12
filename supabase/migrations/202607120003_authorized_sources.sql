begin;

create table if not exists shorts_mvp.authorized_sources (
  youtube_video_id text primary key
    check (youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  source_key text not null
    check (
      char_length(source_key) between 1 and 1024
      and source_key ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
      and source_key !~ '(^|/)\.\.(/|$)'
      and source_key !~ '//'
    ),
  source_sha256 text
    check (source_sha256 is null or source_sha256 ~ '^[a-f0-9]{64}$'),
  rights_note text not null
    check (char_length(rights_note) between 3 and 500),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table shorts_mvp.authorized_sources enable row level security;
revoke all on shorts_mvp.authorized_sources from anon, authenticated;

create index if not exists authorized_sources_enabled_idx
  on shorts_mvp.authorized_sources (youtube_video_id)
  where enabled;

commit;
