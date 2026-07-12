begin;

drop table if exists shorts_mvp.authorized_sources;

create table if not exists shorts_mvp.ingestion_circuit (
  singleton boolean primary key default true check (singleton),
  blocked_until timestamptz,
  reason text check (reason is null or char_length(reason) <= 200),
  updated_at timestamptz not null default now()
);

insert into shorts_mvp.ingestion_circuit (singleton)
values (true)
on conflict (singleton) do nothing;

alter table shorts_mvp.ingestion_circuit enable row level security;
revoke all on shorts_mvp.ingestion_circuit from anon, authenticated;

commit;
