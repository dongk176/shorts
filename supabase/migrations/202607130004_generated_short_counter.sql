create table if not exists shorts_mvp.site_metrics (
  key text primary key,
  value bigint not null check (value >= 0),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

insert into shorts_mvp.site_metrics (key, value)
values ('generated_shorts', 4321)
on conflict (key) do nothing;
