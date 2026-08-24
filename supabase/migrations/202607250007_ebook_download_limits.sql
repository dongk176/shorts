begin;

create table if not exists shorts_mvp.ebook_download_counters (
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  ebook_slug text not null check (
    ebook_slug in (
      'monetization-7',
      'multi-platform',
      'copyright-survival',
      'monetization-playbook',
      'viral-formula',
      'low-views-diagnosis',
      'title-300'
    )
  ),
  download_count smallint not null default 1 check (download_count between 1 and 10),
  first_downloaded_at timestamptz not null default now(),
  last_downloaded_at timestamptz not null default now(),
  primary key (user_id,ebook_slug)
);

alter table shorts_mvp.ebook_download_counters enable row level security;
revoke all on table shorts_mvp.ebook_download_counters from anon, authenticated;
grant all on table shorts_mvp.ebook_download_counters to service_role;

comment on table shorts_mvp.ebook_download_counters is
  'Lifetime per-account download counters for paid ebook PDFs.';
comment on column shorts_mvp.ebook_download_counters.download_count is
  'Successful download responses claimed by this account, capped at 10 per ebook.';

commit;
