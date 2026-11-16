create table shorts_mvp.media_traffic_events (
 id uuid primary key,
 recorded_at timestamptz not null default now(),
 user_id uuid references shorts_mvp.app_users(id) on delete set null,
 project_id uuid,
 resource text not null check(length(resource)<=200),
 provider text not null check(provider in ('vercel_sandbox','aws_cloudfront','aws_storage')),
 purpose text not null check(length(purpose)<=40),
 measurement text not null check(measurement in ('server_write','downloader_report','browser_resource','unmeasured')),
 bytes bigint check(bytes between 0 and 10737418240),
 requests integer not null default 1 check(requests between 1 and 10000),
 interrupted boolean not null default false,
 environment text not null check(environment in ('production','candidate')),
 check((measurement='unmeasured' and bytes is null) or (measurement<>'unmeasured' and bytes is not null))
);
create index media_traffic_events_time on shorts_mvp.media_traffic_events(recorded_at desc);
create index media_traffic_events_user_time on shorts_mvp.media_traffic_events(user_id,recorded_at desc);
create index media_traffic_events_project_time on shorts_mvp.media_traffic_events(project_id,recorded_at desc);
alter table shorts_mvp.media_traffic_events enable row level security;
revoke all on shorts_mvp.media_traffic_events from public,anon,authenticated;
create table shorts_mvp.media_traffic_test_accounts (
 user_id uuid primary key references shorts_mvp.app_users(id) on delete cascade,
 label text not null check(length(label) between 1 and 100),
 updated_by uuid references shorts_mvp.app_users(id) on delete set null,
 updated_at timestamptz not null default now()
);
alter table shorts_mvp.media_traffic_test_accounts enable row level security;
revoke all on shorts_mvp.media_traffic_test_accounts from public,anon,authenticated;

grant select,insert,update,delete on shorts_mvp.media_traffic_events,shorts_mvp.media_traffic_test_accounts to service_role;
