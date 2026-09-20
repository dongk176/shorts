-- Administrator-only TikTok review rollout, explicitly authorized 2026-09-21.
-- Apply in its own transaction after verifying the production database identity.
do $$ begin
  if current_setting('app.tiktok_admin_review', true) is distinct from 'true' then
    raise exception 'Explicit administrator TikTok rollout setting is required';
  end if;
end $$;

create table shorts_mvp.tiktok_review_settings (
  origin text primary key check(origin='https://www.easycut.co.kr'),
  verified_at timestamptz
);
insert into shorts_mvp.tiktok_review_settings(origin) values('https://www.easycut.co.kr');
alter table shorts_mvp.tiktok_review_settings enable row level security;
revoke all on shorts_mvp.tiktok_review_settings from public,anon,authenticated;
grant select,update on shorts_mvp.tiktok_review_settings to service_role;

create table shorts_mvp.tiktok_owners (
  user_id uuid primary key references shorts_mvp.app_users(id) on delete cascade,
  epoch integer not null default 0,
  disconnect_until timestamptz
);
create table shorts_mvp.tiktok_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  app_key text not null,
  open_id varchar(128) not null,
  nickname varchar(255) not null,
  username varchar(255) not null,
  token_ciphertext text not null,
  status text not null default 'active' check(status in ('active','reconnect_required')),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  unique(app_key,open_id)
);
create index tiktok_connections_owner on shorts_mvp.tiktok_connections(user_id);
create table shorts_mvp.tiktok_oauth (
  state_hash char(64) primary key,
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  app_key text not null,
  session_hash char(64) not null,
  return_path text not null check(return_path ~ '^/((en|jp)/)?(settings|publish/channels|projects/[1-9][0-9]*)$'),
  short_id uuid references shorts_mvp.generated_shorts(id) on delete cascade,
  epoch integer not null,
  expires_at timestamptz not null default now()+interval '10 minutes',
  unique(user_id,app_key)
);
create table shorts_mvp.tiktok_posts (
  id uuid primary key,
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  connection_id uuid not null references shorts_mvp.tiktok_connections(id) on delete cascade,
  connection_version integer not null,
  short_id uuid not null references shorts_mvp.generated_shorts(id) on delete cascade,
  render_version integer not null,
  title text not null,
  privacy text not null check(privacy='SELF_ONLY'),
  consent_ciphertext text not null,
  source_key text not null,
  source_hash char(64) not null,
  media_hash char(64) unique,
  media_expires_at timestamptz not null default now()+interval '90 minutes',
  publish_id varchar(64),
  status text not null check(status in ('initiating','processing','complete','failed','unknown')),
  error_code text,
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  unique(user_id,short_id,render_version,connection_id)
);
create index tiktok_posts_owner on shorts_mvp.tiktok_posts(user_id,short_id,created_at desc);
alter table shorts_mvp.tiktok_owners enable row level security;
alter table shorts_mvp.tiktok_connections enable row level security;
alter table shorts_mvp.tiktok_oauth enable row level security;
alter table shorts_mvp.tiktok_posts enable row level security;
revoke all on shorts_mvp.tiktok_owners,shorts_mvp.tiktok_connections,shorts_mvp.tiktok_oauth,shorts_mvp.tiktok_posts from public,anon,authenticated;
grant select,insert,update,delete on shorts_mvp.tiktok_owners,shorts_mvp.tiktok_connections,shorts_mvp.tiktok_oauth,shorts_mvp.tiktok_posts to service_role;

-- Withdrawal invalidates all media capabilities and erases stored grant data.
create function shorts_mvp.delete_withdrawn_tiktok_data() returns trigger
language plpgsql security definer set search_path=pg_catalog,shorts_mvp as $$
begin
  delete from shorts_mvp.tiktok_connections where user_id=new.id;
  delete from shorts_mvp.tiktok_oauth where user_id=new.id;
  delete from shorts_mvp.tiktok_owners where user_id=new.id;
  return new;
end $$;
revoke all on function shorts_mvp.delete_withdrawn_tiktok_data() from public,anon,authenticated;
create trigger tiktok_withdrawal_cleanup after update of withdrawn_at on shorts_mvp.app_users
for each row when (old.withdrawn_at is null and new.withdrawn_at is not null)
execute function shorts_mvp.delete_withdrawn_tiktok_data();
