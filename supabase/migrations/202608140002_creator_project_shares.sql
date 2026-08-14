begin;

alter table shorts_mvp.referral_partners
  drop constraint if exists referral_partners_creator_project_reserved_check;
alter table shorts_mvp.referral_partners
  add constraint referral_partners_creator_project_reserved_check
  check (slug <> 'creator-project');

create table if not exists shorts_mvp.creator_project_shares (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique
    references shorts_mvp.video_jobs(id) on delete cascade,
  recipient_name text not null check (
    char_length(recipient_name) between 1 and 100
  ),
  token_hash text not null unique check (
    length(token_hash) = 64 and token_hash ~ '^[0-9a-f]{64}$'
  ),
  created_by_user_id uuid not null
    references shorts_mvp.app_users(id) on delete restrict,
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    expires_at > issued_at
    and expires_at <= issued_at + interval '7 days'
  ),
  check (revoked_at is null or revoked_at >= issued_at)
);

create index if not exists creator_project_shares_status_idx
  on shorts_mvp.creator_project_shares (expires_at,revoked_at);
create index if not exists creator_project_shares_admin_issued_idx
  on shorts_mvp.creator_project_shares (created_by_user_id,issued_at desc);

create table if not exists shorts_mvp.creator_project_share_visitors (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null
    references shorts_mvp.creator_project_shares(id) on delete cascade,
  mvp_session_id uuid not null
    references shorts_mvp.mvp_sessions(id) on delete restrict,
  first_viewed_at timestamptz not null default clock_timestamp(),
  last_viewed_at timestamptz not null default clock_timestamp(),
  view_count integer not null default 1 check (view_count >= 1),
  last_view_request_id uuid not null,
  first_cta_clicked_at timestamptz,
  last_cta_clicked_at timestamptz,
  cta_click_count integer not null default 0 check (cta_click_count >= 0),
  last_cta_request_id uuid,
  converted_user_id uuid
    references shorts_mvp.app_users(id) on delete set null,
  converted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (share_id,mvp_session_id),
  check (last_viewed_at >= first_viewed_at),
  check (
    (cta_click_count = 0 and first_cta_clicked_at is null
      and last_cta_clicked_at is null and last_cta_request_id is null)
    or
    (cta_click_count > 0 and first_cta_clicked_at is not null
      and last_cta_clicked_at is not null and last_cta_request_id is not null
      and last_cta_clicked_at >= first_cta_clicked_at)
  ),
  check (
    (converted_user_id is null and converted_at is null)
    or (converted_user_id is not null and converted_at is not null)
  )
);

create index if not exists creator_share_visitors_share_viewed_idx
  on shorts_mvp.creator_project_share_visitors (share_id,last_viewed_at desc);
create index if not exists creator_share_visitors_session_cta_idx
  on shorts_mvp.creator_project_share_visitors
  (mvp_session_id,last_cta_clicked_at desc)
  where last_cta_clicked_at is not null and converted_at is null;
create unique index if not exists creator_share_visitors_converted_user_idx
  on shorts_mvp.creator_project_share_visitors (converted_user_id)
  where converted_user_id is not null;

alter table shorts_mvp.creator_project_shares enable row level security;
alter table shorts_mvp.creator_project_share_visitors enable row level security;
revoke all on shorts_mvp.creator_project_shares from anon, authenticated;
revoke all on shorts_mvp.creator_project_share_visitors from anon, authenticated;
grant all on shorts_mvp.creator_project_shares to service_role;
grant all on shorts_mvp.creator_project_share_visitors to service_role;

drop trigger if exists creator_project_shares_set_updated_at
  on shorts_mvp.creator_project_shares;
create trigger creator_project_shares_set_updated_at
before update on shorts_mvp.creator_project_shares
for each row execute function shorts_mvp.set_updated_at();

drop trigger if exists creator_project_share_visitors_set_updated_at
  on shorts_mvp.creator_project_share_visitors;
create trigger creator_project_share_visitors_set_updated_at
before update on shorts_mvp.creator_project_share_visitors
for each row execute function shorts_mvp.set_updated_at();

commit;
