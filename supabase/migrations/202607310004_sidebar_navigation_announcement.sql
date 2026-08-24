begin;

create table if not exists shorts_mvp.member_ui_announcement_campaigns (
  campaign_code text primary key,
  eligibility_cutoff timestamptz not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shorts_mvp.member_ui_announcement_receipts (
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  campaign_code text not null
    references shorts_mvp.member_ui_announcement_campaigns(campaign_code)
    on delete cascade,
  presented_at timestamptz not null default now(),
  primary key (user_id,campaign_code)
);

create index if not exists member_ui_announcement_receipts_campaign_idx
  on shorts_mvp.member_ui_announcement_receipts (campaign_code,presented_at desc);

drop trigger if exists member_ui_announcement_campaigns_set_updated_at
  on shorts_mvp.member_ui_announcement_campaigns;
create trigger member_ui_announcement_campaigns_set_updated_at
before update on shorts_mvp.member_ui_announcement_campaigns
for each row execute function shorts_mvp.set_updated_at();

insert into shorts_mvp.member_ui_announcement_campaigns (
  campaign_code,
  eligibility_cutoff,
  enabled
) values (
  'sidebar_navigation_v1',
  clock_timestamp(),
  false
)
on conflict (campaign_code) do nothing;

alter table shorts_mvp.member_ui_announcement_campaigns enable row level security;
alter table shorts_mvp.member_ui_announcement_receipts enable row level security;

revoke all on table shorts_mvp.member_ui_announcement_campaigns from anon, authenticated;
revoke all on table shorts_mvp.member_ui_announcement_receipts from anon, authenticated;

grant all on table shorts_mvp.member_ui_announcement_campaigns to service_role;
grant all on table shorts_mvp.member_ui_announcement_receipts to service_role;

comment on table shorts_mvp.member_ui_announcement_campaigns is
  'Server-owned one-time UI announcement campaigns. eligibility_cutoff separates existing members from later signups.';
comment on table shorts_mvp.member_ui_announcement_receipts is
  'Account-wide atomic presentation receipts for one-time UI announcements.';

commit;
