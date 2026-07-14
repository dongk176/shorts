begin;

alter table shorts_mvp.app_users
  add column if not exists display_name text,
  add column if not exists avatar_url text,
  add column if not exists provider text,
  add column if not exists selected_plan_code text not null default 'plus',
  add column if not exists last_sign_in_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'app_users_selected_plan_code_fkey'
      and conrelid = 'shorts_mvp.app_users'::regclass
  ) then
    alter table shorts_mvp.app_users
      add constraint app_users_selected_plan_code_fkey
      foreign key (selected_plan_code) references shorts_mvp.plans(code);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'app_users_auth_user_id_fkey'
      and conrelid = 'shorts_mvp.app_users'::regclass
  ) then
    alter table shorts_mvp.app_users
      add constraint app_users_auth_user_id_fkey
      foreign key (auth_user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

alter table shorts_mvp.mvp_sessions
  add column if not exists user_id uuid references shorts_mvp.app_users(id) on delete set null;

alter table shorts_mvp.youtube_analyses
  add column if not exists user_id uuid references shorts_mvp.app_users(id) on delete set null;

create index if not exists mvp_sessions_user_seen_idx
  on shorts_mvp.mvp_sessions (user_id, last_seen_at desc)
  where user_id is not null;
create index if not exists youtube_analyses_user_expires_idx
  on shorts_mvp.youtube_analyses (user_id, expires_at)
  where user_id is not null;
create index if not exists video_jobs_user_created_idx
  on shorts_mvp.video_jobs (user_id, created_at desc)
  where user_id is not null;
create index if not exists generated_shorts_user_created_idx
  on shorts_mvp.generated_shorts (user_id, created_at desc)
  where user_id is not null;
create index if not exists usage_reservations_user_created_idx
  on shorts_mvp.usage_reservations (user_id, created_at)
  where user_id is not null;
create index if not exists usage_events_user_occurred_idx
  on shorts_mvp.usage_events (user_id, occurred_at)
  where user_id is not null;

commit;
